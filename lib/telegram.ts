const TELEGRAM_API = "https://api.telegram.org";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
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
