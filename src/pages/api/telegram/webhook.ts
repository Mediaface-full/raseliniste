import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { sendMessage, sendTyping, getFilePath, type TelegramUpdate } from "@/lib/telegram";
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
  if (!msg || (!msg.text && !msg.voice)) {
    // Ignoruj typing indicators, edits bez textu, fotky apod.
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
  if (msg.voice) {
    // Gideon 2026-07-05: hlasovka → Gemini přepis (stejná pipeline jako
    // Studánka/Ozvěna) → text do agenta. OGG/Opus, typicky pár set kB.
    const voice = msg.voice;
    void handleVoiceMessage(chatId, voice.file_id, voice.mime_type, user.id).catch((e) => {
      console.error("[telegram] voice handler failed:", e instanceof Error ? e.message : e);
    });
  } else {
    void handleMessage(chatId, msg.text!, user.id).catch((e) => {
      console.error("[telegram] handler failed:", e instanceof Error ? e.message : e);
    });
  }

  return new Response("ok", { status: 200 });
};

async function handleVoiceMessage(
  chatId: number,
  fileId: string,
  mimeType: string | undefined,
  userId: string,
): Promise<void> {
  const typingInterval = setInterval(() => {
    void sendTyping(chatId).catch(() => null);
  }, 4000);
  await sendTyping(chatId);

  try {
    // 1) Stáhni OGG z Telegram file API
    const fileUrl = await getFilePath(fileId);
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());

    // 2) Gemini přepis (sdílená pipeline se Studánkou)
    const { transcribeAudioOnly } = await import("@/lib/audio-transcribe");
    const { transcript } = await transcribeAudioOnly({
      audio,
      mimeType: mimeType ?? "audio/ogg",
    });

    const text = transcript.trim();
    if (!text) {
      await sendMessage(chatId, "Z hlasovky jsem nic nevyrozuměl — zkus to znovu nebo napiš text.");
      return;
    }

    // 3) Ukaž co jsem slyšel + pošli do agenta
    await sendMessage(chatId, `🎙 „${text}"`);
    const reply = await runAgent({ userMessage: text, userId });
    await sendMessage(chatId, reply);
  } catch (e) {
    console.error("[telegram] voice error:", e instanceof Error ? e.stack : e);
    await sendMessage(chatId, `Hlasovku se nepodařilo zpracovat: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearInterval(typingInterval);
  }
}

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
  // Petr 2026-06-22: masked preview secretů — Gideon může srovnat "live test"
  // přes HTTPS s tím co dává do curl setWebhook. Bez leakování celé hodnoty.
  function preview(v: unknown): string {
    if (typeof v !== "string" || !v) return "(nenastaveno)";
    if (v.length <= 8) return `(short, len=${v.length})`;
    return `${v.slice(0, 6)}…${v.slice(-4)} (len=${v.length})`;
  }

  const secret = env.TELEGRAM_WEBHOOK_SECRET as string | undefined;
  const token = env.TELEGRAM_BOT_TOKEN as string | undefined;
  const anthropicKey = env.ANTHROPIC_API_KEY as string | undefined;

  const cfg = {
    anthropic_key: preview(anthropicKey),
    telegram_token: preview(token),
    telegram_token_number: token ? token.split(":")[0] : "(nenastaveno)",
    allowed_user_id: env.TELEGRAM_ALLOWED_USER_ID ?? "(nenastaveno — v logu po první zprávě)",
    webhook_secret: preview(secret),
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    tips: [
      "Porovnej webhook_secret prefix+suffix se secretem co dáváš do setWebhook.",
      "Když sedí prefix+suffix ale Telegram vrací 401 → někde v mezi znacích je typo.",
      "telegram_token_number musí sedět s ID bota v @BotFather.",
    ],
  };
  return Response.json({ ok: true, ...cfg });
};
