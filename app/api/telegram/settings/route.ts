import { loadConfig, saveConfig, type TelegramConfig } from "@/lib/telegram-config";
import { setTelegramWebhook, getTelegramWebhookInfo } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  // Also fetch webhook status if we have a token
  let webhookInfo = null;
  if (config.botToken) {
    try {
      const info = await getTelegramWebhookInfo(config.botToken);
      if (info.ok) {
        webhookInfo = info.result;
      }
    } catch {
      // ignore
    }
  }
  return Response.json({ config, webhookInfo });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  if (action === "save") {
    const { botToken, companies } = body as {
      action: string;
      botToken?: string;
      companies?: TelegramConfig["companies"];
    };
    const config = await loadConfig();
    if (botToken !== undefined) config.botToken = botToken;
    if (companies) {
      // Merge company configs
      for (const [companyId, companyConfig] of Object.entries(companies)) {
        config.companies[companyId] = {
          ...config.companies[companyId],
          ...companyConfig,
        };
      }
    }
    await saveConfig(config);
    return Response.json({ ok: true, config });
  }

  if (action === "setWebhook") {
    const { webhookUrl } = body as { action: string; webhookUrl: string };
    const config = await loadConfig();
    if (!config.botToken) {
      return Response.json({ ok: false, error: "No bot token configured" }, { status: 400 });
    }
    const result = await setTelegramWebhook(config.botToken, webhookUrl);
    return Response.json(result);
  }

  if (action === "testConnection") {
    const { chatId } = body as { action: string; chatId: string };
    const config = await loadConfig();
    if (!config.botToken) {
      return Response.json({ ok: false, error: "No bot token configured" }, { status: 400 });
    }
    const { sendTelegramMessage } = await import("@/lib/telegram");
    const result = await sendTelegramMessage(
      config.botToken,
      chatId,
      "Test message from Wix AI Business Manager. Connection is working!"
    );
    return Response.json(result);
  }

  return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
