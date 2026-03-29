import { loadConfig, saveConfig } from "@/lib/telegram-config";
import { sendTelegramMessage } from "@/lib/telegram";

const PAPERCLIP_API_URL =
  process.env.PAPERCLIP_API_URL ||
  process.env.NEXT_PUBLIC_PAPERCLIP_API_URL ||
  "http://localhost:3100/api";

async function paperclip(path: string, options?: RequestInit) {
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
  return res.json();
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { first_name?: string; last_name?: string; username?: string };
  };
}

export async function POST(request: Request) {
  try {
    const update: TelegramUpdate = await request.json();

    const message = update.message;
    if (!message?.text) {
      return Response.json({ ok: true, skipped: "no text message" });
    }

    const chatId = String(message.chat.id);
    const senderName =
      [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
      message.from?.username ||
      "Telegram User";
    const text = message.text;

    // Look up which company this chat_id belongs to
    const config = await loadConfig();
    let companyId: string | null = null;

    for (const [cid, companyConfig] of Object.entries(config.companies)) {
      if (companyConfig.chatId === chatId && companyConfig.enabled) {
        companyId = cid;
        break;
      }
    }

    if (!companyId) {
      console.log(`[Telegram Webhook] Unknown chat_id: ${chatId}. Not mapped to any company.`);
      return Response.json({ ok: true, skipped: "unmapped chat_id" });
    }

    // Find CEO agent
    const agents = await paperclip(`/companies/${companyId}/agents`);
    const ceo = agents.find((a: { role: string }) => a.role === "ceo");
    if (!ceo) {
      console.error(`[Telegram Webhook] No CEO agent found for company ${companyId}`);
      return Response.json({ ok: true, error: "no CEO agent" });
    }

    // Find or create Board Inbox issue
    const issues = await paperclip(`/companies/${companyId}/issues`);
    let inbox = issues.find((i: { title: string }) => i.title === "Board Inbox");
    if (!inbox) {
      inbox = await paperclip(`/companies/${companyId}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title: "Board Inbox",
          description: "Direct communication channel between the board operator and the CEO.",
          priority: "high",
          assigneeId: ceo.id,
        }),
      });
    }

    // Post the message as a comment
    const commentBody = `[Telegram from ${senderName}] ${text}`;
    await paperclip(`/issues/${inbox.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: commentBody }),
    });

    // Invoke CEO heartbeat
    try {
      await paperclip(`/agents/${ceo.id}/heartbeat/invoke`, { method: "POST" });
    } catch (err) {
      console.error(`[Telegram Webhook] Failed to invoke heartbeat:`, err);
    }

    // Start a background polling loop to wait for CEO response and send it back
    pollForResponse(config.botToken, chatId, inbox.id, companyId, ceo.id).catch((err) =>
      console.error(`[Telegram Webhook] Polling error:`, err)
    );

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error:", err);
    return Response.json({ ok: true, error: "internal" });
  }
}

async function pollForResponse(
  botToken: string,
  chatId: string,
  issueId: string,
  companyId: string,
  ceoAgentId: string
) {
  // Get current comments to know the baseline
  const currentComments = await paperclip(`/issues/${issueId}/comments`);
  const baselineCount = currentComments.length;
  const baselineIds = new Set(currentComments.map((c: { id: string }) => c.id));

  // Poll for up to 5 minutes
  const maxAttempts = 60;
  const pollInterval = 5000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const comments = await paperclip(`/issues/${issueId}/comments`);
      if (comments.length > baselineCount) {
        // Find new comments from the CEO agent
        const newAgentComments = comments.filter(
          (c: { id: string; authorAgentId: string | null }) =>
            !baselineIds.has(c.id) && c.authorAgentId
        );

        if (newAgentComments.length > 0) {
          // Send each new agent comment to Telegram
          for (const comment of newAgentComments) {
            await sendTelegramMessage(botToken, chatId, comment.body);
          }

          // Update last sent comment ID
          const config = await loadConfig();
          for (const [cid, companyConfig] of Object.entries(config.companies)) {
            if (companyConfig.chatId === chatId) {
              config.companies[cid].lastSentCommentId =
                newAgentComments[newAgentComments.length - 1].id;
              break;
            }
          }
          await saveConfig(config);
          return;
        }
      }
    } catch (err) {
      console.error("[Telegram Webhook] Poll iteration error:", err);
    }
  }

  console.log("[Telegram Webhook] Polling timed out waiting for CEO response");
}
