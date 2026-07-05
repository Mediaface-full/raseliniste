import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { sendMessage, sendTyping, type TelegramUpdate } from "@/lib/telegram";
import { runAgent } from "@/lib/telegram-agent";

export const prerender = false;

/**
 * Petr 2026-06-22: Telegram webhook endpoint pro ClaudeClaw.
 *
 * Setup po deployi (jednorázově):
 *   1. @BotFather → /newbot → jméno ClaudeClaw → username claudeclaw_bot
 *      → dostaneš TELEGRAM_BOT_TOKEN
 *   2. Napiš /start botovi → server log vypíše tvůj Telegram user ID
 *   3. Nastav env vars v docker-compose.yml:
 *      - ANTHROPIC_API_KEY  (z console.anthropic.com)
 *      - TELEGRAM_BOT_TOKEN
 *      - TELEGRAM_ALLOWED_USER_ID  (user ID z logu, jen Gideon)
 *      - TELEGRAM_WEBHOOK_SECRET  (openssl rand -hex 24)
 *   4. Register webhook (curl):
 *      curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *        -d url=https://www.raseliniste.cz/api/telegram/webhook \
 *        -d secret_token=<WEBHOOK_SECRET>
 *
 * Auth: Telegram posílá header `X-Telegram-Bot-Api-Secret-Token`. Bez
 * matchu s TELEGRAM_WEBHOOK_SECRET vrátíme 401 (útočník si nemůže
 * poslat vlastní update).
 *
 * Whitelist: jen Gideon (TELEGRAM_ALLOWED_USER_ID) smí volat. Cizí user ID
 * se logne + ignoruje (bez odpovědi = bot pro cizí lidi vypadá mrtvý).
 */
export const POST: APIRoute = async ({ request }) => {
  // 1) Ověř secret token (Telegram-side auth)
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET nenastaveno");
    return new Response("not configured", { status: 503 });
  }
  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (incomingSecret !== secret) {
    console.warn("[telegram] invalid secret token");
    return new Response("unauthorized", { status: 401 });
  }

  // 2) Parse update
  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const msg = update.message ?? update.edited_message;
  if (!msg || !msg.text) {
    // Ignoruj typing indicators, edits bez textu, voice zatím neřešíme
    return new Response("ok", { status: 200 });
  }

  const fromId = String(msg.from.id);
  const chatId = msg.chat.id;

  // 3) Whitelist Gideon
  const allowedUserId = env.TELEGRAM_ALLOWED_USER_ID;
  if (!allowedUserId) {
    console.log(`[telegram] TELEGRAM_ALLOWED_USER_ID nenastaveno. Tvůj user ID: ${fromId}`);
    console.log("[telegram] Přidej ho do env vars a redeploy.");
    return new Response("ok", { status: 200 });
  }
  if (fromId !== allowedUserId) {
    console.warn(`[telegram] neautorizovaný user: ${fromId} (${msg.from.username ?? "?"})`);
    return new Response("ok", { status: 200 });
  }

  // 4) Najdi Gideonova User v DB (single-user systém → první user)
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.error("[telegram] žádný User v DB");
    await sendMessage(chatId, "Rašeliniště nemá žádného uživatele. Přihlaš se na webu.");
    return new Response("ok", { status: 200 });
  }

  // 5) Zpracuj asynchronně — Telegram chce 200 rychle (< 5s), jinak retry
  //    fire-and-forget: vrátíme 200 hned, agent běží na pozadí
  void handleMessage(chatId, msg.text, user.id).catch((e) => {
    console.error("[telegram] handler failed:", e instanceof Error ? e.message : e);
  });

  return new Response("ok", { status: 200 });
};

async function handleMessage(chatId: number, text: string, userId: string): Promise<void> {
  // Ukaž "typing…" hned + každých 4s (agent volá tools = může trvat 5-15s)
  const typingInterval = setInterval(() => {
    void sendTyping(chatId).catch(() => null);
  }, 4000);
  await sendTyping(chatId);

  try {
    // Speciální příkazy před AI voláním
    if (text.startsWith("/start")) {
      await sendMessage(
        chatId,
        "Ahoj Gideone. Jsem ClaudeClaw — ptej se mě na úkoly, kalendář, Studánku nebo obecně 'co dnes' / 'co je nového'.",
      );
      return;
    }
    if (text.startsWith("/help")) {
      await sendMessage(
        chatId,
        [
          "Umím:",
          "• 'co dnes' / 'co zítra' — souhrn programu",
          "• 'úkoly na dnes' / 'zpožděné úkoly' / 'úkoly na týden'",
          "• 'co Karel' — úkoly pro konkrétní osobu",
          "• 'schůzky zítra' / 'kalendář týden'",
          "• 'co je nového ve Studánce' / 'co poslal Karel'",
          "",
          "Zeptej se přirozeně — ne příkazem.",
        ].join("\n"),
      );
      return;
    }

    const reply = await runAgent({ userMessage: text, userId });
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error("[telegram] agent error:", e instanceof Error ? e.stack : e);
    await sendMessage(
      chatId,
      `Chyba: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * GET pro health-check + zjištění stavu (dá se otevřít v browseru).
 */
export const GET: APIRoute = async () => {
  const cfg = {
    anthropic_key: Boolean(env.ANTHROPIC_API_KEY),
    telegram_token: Boolean(env.TELEGRAM_BOT_TOKEN),
    allowed_user_id: env.TELEGRAM_ALLOWED_USER_ID ?? "(nenastaveno — bude v logu po první zprávě)",
    webhook_secret: env.TELEGRAM_WEBHOOK_SECRET ? "(set)" : "(nenastaveno)",
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  };
  return Response.json({ ok: true, ...cfg });
};
