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

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  const results: Array<{ companyId: string; sent: number; error?: string }> = [];

  for (const [companyId, companyConfig] of Object.entries(config.companies)) {
    if (!companyConfig.enabled || !companyConfig.chatId) continue;

    try {
      // Find Board Inbox issue
      const issues = await paperclip(`/companies/${companyId}/issues`);
      const inbox = issues.find((i: { title: string }) => i.title === "Board Inbox");
      if (!inbox) {
        results.push({ companyId, sent: 0, error: "No Board Inbox issue" });
        continue;
      }

      // Get comments
      const comments = await paperclip(`/issues/${inbox.id}/comments`);
      if (!comments.length) {
        results.push({ companyId, sent: 0 });
        continue;
      }

      // Find new agent comments since last sent
      const lastSentId = companyConfig.lastSentCommentId;
      let newComments: Array<{ id: string; body: string; authorAgentId: string | null }>;

      if (lastSentId) {
        const lastSentIndex = comments.findIndex(
          (c: { id: string }) => c.id === lastSentId
        );
        if (lastSentIndex === -1) {
          // Last sent comment not found, only send the most recent agent comment
          const agentComments = comments.filter(
            (c: { authorAgentId: string | null }) => c.authorAgentId
          );
          newComments = agentComments.length > 0 ? [agentComments[agentComments.length - 1]] : [];
        } else {
          newComments = comments
            .slice(lastSentIndex + 1)
            .filter((c: { authorAgentId: string | null }) => c.authorAgentId);
        }
      } else {
        // First time: don't send old comments, just record the latest
        const agentComments = comments.filter(
          (c: { authorAgentId: string | null }) => c.authorAgentId
        );
        if (agentComments.length > 0) {
          config.companies[companyId].lastSentCommentId =
            agentComments[agentComments.length - 1].id;
        }
        results.push({ companyId, sent: 0 });
        continue;
      }

      // Send new comments to Telegram
      let sentCount = 0;
      for (const comment of newComments) {
        const sendResult = await sendTelegramMessage(
          config.botToken,
          companyConfig.chatId,
          comment.body
        );
        if (sendResult.ok) {
          config.companies[companyId].lastSentCommentId = comment.id;
          sentCount++;
        } else {
          console.error(
            `[Telegram Poll] Failed to send message to ${companyConfig.chatId}:`,
            sendResult.description
          );
        }
      }

      results.push({ companyId, sent: sentCount });
    } catch (err) {
      results.push({
        companyId,
        sent: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // Save updated config (lastSentCommentId may have changed)
  await saveConfig(config);

  return Response.json({ ok: true, results });
}
