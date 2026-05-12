import type { APIRoute } from "astro";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { processHistoryFromPush } from "@/lib/gmail-watch";

export const prerender = false;

/**
 * POST /api/posta/gmail-webhook
 *
 * Gmail push notification handler (Cloud Pub/Sub).
 * - Pub/Sub doručí push request s JWT v `Authorization: Bearer <jwt>`
 *   header, podepsaný Google service accountem (GMAIL_PUBSUB_SA_EMAIL).
 * - Body je base64-encoded JSON: { emailAddress, historyId }
 * - **Musíme vrátit 200 do 10s** jinak Pub/Sub retryuje. Tj. async fetch
 *   nového mailu spustíme jako fire-and-forget (Petrovo zadání).
 *
 * Verifikace:
 * 1. JWT v Authorization header musí být platný (Google podepsaný)
 * 2. audience = GMAIL_PUBSUB_AUDIENCE (URL tohoto endpointu)
 * 3. issuer = "https://accounts.google.com"
 * 4. email v claimu = GMAIL_PUBSUB_SA_EMAIL
 *
 * Pokud cokoli z toho selže → 401 (Pub/Sub se zastaví, Petr to uvidí
 * v logu jako "auth failures").
 *
 * Pattern shodný s `google-auth-library` Pub/Sub push verification.
 */

const inFlightFetches = new Set<Promise<unknown>>();

export const POST: APIRoute = async ({ request }) => {
  const audience = env.GMAIL_PUBSUB_AUDIENCE;
  const expectedSa = env.GMAIL_PUBSUB_SA_EMAIL;

  if (!audience || !expectedSa) {
    return Response.json(
      { error: "GMAIL_PUBSUB not configured (missing GMAIL_PUBSUB_AUDIENCE or _SA_EMAIL)" },
      { status: 503 },
    );
  }

  // 1) Verify JWT
  const authHeader = request.headers.get("authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    console.warn("[gmail-webhook] missing/malformed Authorization header");
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const token = m[1];

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    if (!payload) {
      return Response.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }
    if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
      return Response.json({ error: "INVALID_ISSUER" }, { status: 401 });
    }
    if (payload.email !== expectedSa) {
      console.warn(
        `[gmail-webhook] SA mismatch: got=${payload.email} expected=${expectedSa}`,
      );
      return Response.json({ error: "INVALID_SA" }, { status: 401 });
    }
    if (payload.email_verified === false) {
      return Response.json({ error: "SA_EMAIL_UNVERIFIED" }, { status: 401 });
    }
  } catch (err) {
    console.warn(`[gmail-webhook] JWT verify failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ error: "INVALID_TOKEN" }, { status: 401 });
  }

  // 2) Parse Pub/Sub envelope
  let parsed: { message?: { data?: string }; subscription?: string };
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const dataB64 = parsed.message?.data;
  if (!dataB64) {
    // Pub/Sub občas pošle "ping" zprávu bez data — ACK
    return Response.json({ ok: true, note: "empty data" });
  }

  let push: { emailAddress?: string; historyId?: string };
  try {
    const json = Buffer.from(dataB64, "base64").toString("utf8");
    push = JSON.parse(json);
  } catch {
    return Response.json({ error: "INVALID_DATA" }, { status: 400 });
  }

  if (!push.emailAddress) {
    return Response.json({ ok: true, note: "no emailAddress in payload" });
  }

  // 3) Najdi usera podle emailAddress — předpokládáme že email v Pub/Sub
  // payloadu se shoduje s UserIntegration auth account.
  //
  // V single-user instance je to triviální: 1 uživatel s gmailWatchTopicName
  // = jediný kandidát. Ale Pub/Sub může pushnout pro různé schránky pokud
  // jich víc bude registrovaných.
  const userIntegration = await prisma.userIntegration.findFirst({
    where: {
      provider: "google",
      user: { gmailWatchTopicName: { not: null } },
    },
    select: { userId: true },
  });

  if (!userIntegration) {
    console.warn(`[gmail-webhook] no user with active watch found for ${push.emailAddress}`);
    return Response.json({ ok: true, note: "no matching user" });
  }

  // 4) Fire-and-forget async processing — musíme vrátit 200 do 10s
  // Module-level Set pinning (stejný pattern jako things-import, audio-transcribe).
  const job = processHistoryFromPush(userIntegration.userId)
    .catch((e) => {
      console.error(
        `[gmail-webhook] processHistoryFromPush failed userId=${userIntegration.userId}: ${e instanceof Error ? e.message : e}`,
      );
    })
    .finally(() => {
      inFlightFetches.delete(job);
    });
  inFlightFetches.add(job);

  return Response.json({ ok: true });
};
