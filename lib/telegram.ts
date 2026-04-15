const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  options?: {
    inlineKeyboard?: TelegramInlineKeyboardButton[][];
    disableWebPagePreview?: boolean;
  },
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: options?.disableWebPagePreview ?? true,
      reply_markup: options?.inlineKeyboard
        ? {
            inline_keyboard: options.inlineKeyboard,
          }
        : undefined,
    }),
  });
  return res.json();
}

export async function answerTelegramCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
  return res.json();
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string
): Promise<{ ok: boolean; result?: boolean; description?: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  return res.json();
}

export async function getTelegramWebhookInfo(
  token: string
): Promise<{ ok: boolean; result?: { url: string; has_custom_certificate: boolean; pending_update_count: number } }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
  return res.json();
}
