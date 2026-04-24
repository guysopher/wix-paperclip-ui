import { loadConfig, saveConfig, type TelegramUserSession } from "@/lib/telegram-config";
import { answerTelegramCallbackQuery, sendTelegramMessage, type TelegramInlineKeyboardButton } from "@/lib/telegram";
import { runCeoChat, type CeoChatMessage } from "@/lib/ceo-chat";
import { withCompanyId } from "@/lib/msid";
import { getResolvedPaperclipApiUrl } from "@/lib/server/deployment-topology";

const PAPERCLIP_API_URL = getResolvedPaperclipApiUrl();

const TELEGRAM_USER_PREFIX = "[Telegram User]";
const TELEGRAM_ASSISTANT_PREFIX = "[AI Team Lead via Telegram]";

async function paperclip<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PAPERCLIP_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Paperclip ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

interface PaperclipCompany {
  id: string;
  name: string;
  status: string;
}

interface PaperclipAgent {
  id: string;
  role: string;
}

interface PaperclipIssue {
  id: string;
  title: string;
}

interface PaperclipComment {
  id: string;
  body: string;
}

interface TelegramUpdate {
  message?: {
    text?: string;
    message_id?: number;
    chat: { id: number };
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: { id: number };
    };
    from: { id: number; first_name?: string; last_name?: string; username?: string };
  };
}

function buildUserLabel(user: { first_name?: string; last_name?: string; username?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Telegram User";
}

function getSession(config: Awaited<ReturnType<typeof loadConfig>>, userId: string): TelegramUserSession {
  return config.sessions[userId] || { activeCompanyId: null, updatedAt: null };
}

async function getCompanies(): Promise<PaperclipCompany[]> {
  const companies = await paperclip<PaperclipCompany[]>("/companies");
  return companies.filter((company) => company.status !== "archived");
}

function buildCompanyKeyboard(companies: PaperclipCompany[], activeCompanyId: string | null): TelegramInlineKeyboardButton[][] {
  return companies.map((company) => [
    {
      text: `${company.id === activeCompanyId ? "• " : ""}${company.name}`,
      callback_data: `company:${company.id}`,
    },
  ]);
}

function getAppBaseUrl(): string | null {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";

  if (!raw) {
    return null;
  }

  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function formatTelegramReply(text: string, companyId: string): string {
  const appBaseUrl = getAppBaseUrl();

  return text.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, (_match, label: string, href: string) => {
    if (!appBaseUrl) {
      return `${label} (${href})`;
    }

    return `${label}: ${appBaseUrl}${withCompanyId(href, companyId)}`;
  });
}

function parseTelegramThread(comments: PaperclipComment[]): CeoChatMessage[] {
  return comments.flatMap<CeoChatMessage>((comment) => {
    if (comment.body.startsWith(`${TELEGRAM_USER_PREFIX} `)) {
      return [{ role: "user", text: comment.body.slice(TELEGRAM_USER_PREFIX.length + 1) }];
    }
    if (comment.body.startsWith(`${TELEGRAM_ASSISTANT_PREFIX} `)) {
      return [{ role: "ceo", text: comment.body.slice(TELEGRAM_ASSISTANT_PREFIX.length + 1) }];
    }
    return [];
  });
}

async function ensureTelegramIssue(companyId: string, userLabel: string): Promise<{ issueId: string; comments: PaperclipComment[] }> {
  const [agents, issues] = await Promise.all([
    paperclip<PaperclipAgent[]>(`/companies/${companyId}/agents`),
    paperclip<PaperclipIssue[]>(`/companies/${companyId}/issues`),
  ]);

  const ceo = agents.find((agent) => agent.role === "ceo");
  const title = `Telegram Chat · ${userLabel}`;
  const existingIssue = issues.find((candidate) => candidate.title === title);
  const issue =
    existingIssue ||
    (await paperclip<PaperclipIssue>(`/companies/${companyId}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description: "Dedicated Telegram conversation thread with the AI Team Lead.",
        priority: "medium",
        assigneeAgentId: ceo?.id,
      }),
    }));

  const issueId = issue.id;
  const comments = await paperclip<PaperclipComment[]>(`/issues/${issueId}/comments`).catch(() => []);
  return { issueId, comments };
}

async function sendCompanyChooser(
  botToken: string,
  chatId: string,
  companies: PaperclipCompany[],
  activeCompanyId: string | null,
) {
  if (companies.length === 0) {
    return sendTelegramMessage(botToken, chatId, "No companies are available yet.");
  }

  const prompt = activeCompanyId
    ? "Choose the company you want me to work on next."
    : "Choose a company first so I know which workspace to use.";

  return sendTelegramMessage(botToken, chatId, prompt, {
    inlineKeyboard: buildCompanyKeyboard(companies, activeCompanyId),
  });
}

async function activateCompany(
  botToken: string,
  chatId: string,
  userId: string,
  companyId: string,
  userLabel: string,
) {
  const config = await loadConfig();
  config.sessions[userId] = {
    activeCompanyId: companyId,
    updatedAt: new Date().toISOString(),
  };
  await saveConfig(config);

  const companies = await getCompanies();
  const company = companies.find((candidate) => candidate.id === companyId);
  const { issueId, comments } = await ensureTelegramIssue(companyId, userLabel);

  await sendTelegramMessage(botToken, chatId, `Active company: ${company?.name || companyId}`);

  if (comments.length > 0) {
    return;
  }

  const result = await runCeoChat(companyId, []);
  if (!result.text) {
    return;
  }

  await paperclip(`/issues/${issueId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `${TELEGRAM_ASSISTANT_PREFIX} ${result.text}` }),
  });

  await sendTelegramMessage(botToken, chatId, formatTelegramReply(result.text, companyId));
}

export async function POST(request: Request) {
  try {
    const update: TelegramUpdate = await request.json();
    const config = await loadConfig();

    if (!config.botToken) {
      return Response.json({ ok: true, skipped: "telegram bot not configured" });
    }

    if (update.callback_query) {
      const chatId = String(update.callback_query.message?.chat.id || "");
      const userId = String(update.callback_query.from.id);
      const userLabel = buildUserLabel(update.callback_query.from);

      if (!config.allowedChatId && chatId) {
        config.allowedChatId = chatId;
        await saveConfig(config);
      }

      if (config.allowedChatId && chatId !== config.allowedChatId) {
        await answerTelegramCallbackQuery(config.botToken, update.callback_query.id, "This chat is not allowed.");
        return Response.json({ ok: true, skipped: "disallowed callback chat" });
      }

      const data = update.callback_query.data || "";
      if (data.startsWith("company:")) {
        const companyId = data.slice("company:".length);
        await answerTelegramCallbackQuery(config.botToken, update.callback_query.id, "Company selected.");
        await activateCompany(config.botToken, chatId, userId, companyId, userLabel);
        return Response.json({ ok: true });
      }

      await answerTelegramCallbackQuery(config.botToken, update.callback_query.id);
      return Response.json({ ok: true, skipped: "unknown callback" });
    }

    const message = update.message;
    if (!message?.text || !message.from) {
      return Response.json({ ok: true, skipped: "no text message" });
    }

    const chatId = String(message.chat.id);
    if (!config.allowedChatId && chatId) {
      config.allowedChatId = chatId;
      await saveConfig(config);
    }

    if (config.allowedChatId && chatId !== config.allowedChatId) {
      return Response.json({ ok: true, skipped: "disallowed chat" });
    }

    const userId = String(message.from.id);
    const userLabel = buildUserLabel(message.from);
    const text = message.text.trim();
    const session = getSession(config, userId);

    if (text === "/clear") {
      config.sessions[userId] = {
        activeCompanyId: null,
        updatedAt: new Date().toISOString(),
      };
      await saveConfig(config);
      await sendTelegramMessage(config.botToken, chatId, "Cleared the active company. Use /company to choose another one.");
      return Response.json({ ok: true });
    }

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(
        config.botToken,
        chatId,
        "Use /company to choose the active company, /companies to see the list again, and /clear to clear the current selection.",
      );
      return Response.json({ ok: true });
    }

    if (text === "/company" || text === "/companies") {
      const companies = await getCompanies();
      await sendCompanyChooser(config.botToken, chatId, companies, session.activeCompanyId);
      return Response.json({ ok: true });
    }

    if (!session.activeCompanyId) {
      await sendTelegramMessage(
        config.botToken,
        chatId,
        "No active company selected. Use /company to choose one first.",
      );
      return Response.json({ ok: true, skipped: "no active company" });
    }

    const companyId = session.activeCompanyId;
    const { issueId, comments } = await ensureTelegramIssue(companyId, userLabel);
    const messages = parseTelegramThread(comments);
    const result = await runCeoChat(companyId, [...messages, { role: "user", text }]);
    const replyText = result.text || "I couldn't produce a response just now. Try again in a moment.";

    await paperclip(`/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `${TELEGRAM_USER_PREFIX} ${text}` }),
    });
    await paperclip(`/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `${TELEGRAM_ASSISTANT_PREFIX} ${replyText}` }),
    });

    await sendTelegramMessage(
      config.botToken,
      chatId,
      formatTelegramReply(replyText, companyId),
    );

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    return Response.json({ ok: true, error: "internal" });
  }
}
