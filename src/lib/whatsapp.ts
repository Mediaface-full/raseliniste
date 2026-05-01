/**
 * WhatsApp odesílání přes Twilio.
 *
 * Credentials uloženy v `UserIntegration(provider="twilio")` šifrovaně:
 *   tokenEnc/tokenIv/tokenTag = AUTH_TOKEN
 *   config = { accountSid: string, fromNumber: string }
 *     - fromNumber: "whatsapp:+14155238886" (sandbox) nebo vlastní WA Business
 *
 * User.whatsappNumber = target (Petrovo číslo v E.164, např. "+420777111222")
 *
 * Sandbox vs Production:
 *   - Sandbox: Twilio dá free WA číslo +14155238886. Petr v telefonu pošle
 *     "join <code>" ze svého WhatsApp, čímž autorizuje příjem zpráv.
 *   - Production: vlastní WA Business číslo (placené, vyžaduje Meta schválení).
 */

import twilio from "twilio";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";

export interface WhatsAppMessage {
  to: string;       // E.164 formát "+420..."
  body: string;     // text zprávy (max 1600 znaků pro WA)
}

export interface SendResult {
  ok: boolean;
  sid?: string;     // Twilio message SID
  error?: string;
}

/**
 * Pošle WhatsApp zprávu z konfigurovaného uživatelova Twilio účtu.
 * Vrátí result objekt — nikdy nethrowuje.
 */
export async function sendWhatsApp(userId: string, msg: WhatsAppMessage): Promise<SendResult> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "twilio" } },
  });
  if (!integration) {
    return { ok: false, error: "Twilio integrace není nakonfigurovaná. Nastavení → WhatsApp." };
  }

  let token: string;
  try {
    token = decryptSecret({
      enc: integration.tokenEnc,
      iv: integration.tokenIv,
      tag: integration.tokenTag,
    });
  } catch (e) {
    return { ok: false, error: `Nelze rozšifrovat Twilio token: ${e instanceof Error ? e.message : String(e)}` };
  }

  const cfg = (integration.config ?? {}) as { accountSid?: string; fromNumber?: string };
  if (!cfg.accountSid || !cfg.fromNumber) {
    return { ok: false, error: "Twilio config chybí accountSid nebo fromNumber." };
  }

  // E.164 → "whatsapp:+420..." (Twilio vyžaduje prefix)
  const toNumber = msg.to.startsWith("whatsapp:") ? msg.to : `whatsapp:${msg.to}`;
  const fromNumber = cfg.fromNumber.startsWith("whatsapp:") ? cfg.fromNumber : `whatsapp:${cfg.fromNumber}`;

  try {
    const client = twilio(cfg.accountSid, token);
    const result = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body: msg.body.slice(0, 1500), // safety pod WA limit 1600
    });

    await prisma.userIntegration.update({
      where: { id: integration.id },
      data: { lastUsedAt: new Date(), lastError: null },
    });

    return { ok: true, sid: result.sid };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await prisma.userIntegration.update({
      where: { id: integration.id },
      data: { lastError: errMsg.slice(0, 500) },
    }).catch(() => null);
    return { ok: false, error: errMsg };
  }
}

/**
 * Helper — pošle zprávu na uživatelovo `whatsappNumber` (target).
 * Pokud user nemá whatsappNumber nastaveno, vrátí error.
 */
export async function sendWhatsAppToUser(userId: string, body: string): Promise<SendResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whatsappNumber: true },
  });
  if (!user?.whatsappNumber) {
    return { ok: false, error: "User.whatsappNumber není nastaveno (Nastavení → WhatsApp)." };
  }
  return sendWhatsApp(userId, { to: user.whatsappNumber, body });
}
