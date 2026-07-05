import { env } from "@/lib/env";

/**
 * Petr 2026-06-22: Telegram Bot API wrapper.
 *
 * Setup:
 *   1. @BotFather v Telegramu → /newbot → jméno "ClaudeClaw" → username
 *      claudeclaw_bot → dostaneš TOKEN, uložit do TELEGRAM_BOT_TOKEN env
 *   2. Napiš botovi jakoukoli zprávu → webhook v serverovém logu vypíše
 *      tvůj TELEGRAM_ALLOWED_USER_ID, nastav do env
 *   3. Setup webhook (jednorázově, přes curl nebo browser):
 *      https://api.telegram.org/bot<TOKEN>/setWebhook
 *        ?url=https://www.raseliniste.cz/api/telegram/webhook
 *        &secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */

const API_BASE = "https://api.telegram.org";

export interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name?: string; username?: string; is_bot: boolean };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

async function callApi<T>(method: string, body: unknown): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error (${method}): ${data.description ?? res.status}`);
  }
  return data.result as T;
}

/**
 * Pošle text zprávu. Chunk na 4096 znaků (Telegram limit).
 * Markdown V2 escapes: pro jednoduchost používáme plain text.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  opts: { reply_to_message_id?: number } = {},
): Promise<TelegramMessage> {
  const MAX = 4000;
  if (text.length <= MAX) {
    return callApi<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...opts,
    });
  }
  // Rozdělit dlouhé zprávy
  let lastMessage: TelegramMessage | undefined;
  for (let i = 0; i < text.length; i += MAX) {
    lastMessage = await callApi<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text: text.slice(i, i + MAX),
    });
  }
  return lastMessage!;
}

/**
 * "Typing…" indikátor. Vyprší za 5s, volat opakovaně během dlouhých operací.
 */
export async function sendTyping(chatId: number): Promise<void> {
  await callApi("sendChatAction", { chat_id: chatId, action: "typing" });
}

/**
 * Voice message download URL. Pro budoucí voice input feature.
 */
export async function getFilePath(fileId: string): Promise<string> {
  const info = await callApi<{ file_path: string }>("getFile", { file_id: fileId });
  return `${API_BASE}/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.file_path}`;
}
