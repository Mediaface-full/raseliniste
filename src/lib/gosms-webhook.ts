/**
 * Helpery pro GoSMS webhook endpointy.
 *
 * GoSMS spec nemá HMAC podpis — autorizace přes secret v query stringu.
 * Webhook URL: /api/webhooks/gosms/(delivery|reply)?token=<webhookSecret>
 *
 * Token matchujeme proti UserIntegration.config.webhookSecret napříč usery
 * (single-user instance — typicky 1 záznam, ale podporujeme multi-user).
 */

import { prisma } from "./db";
import type { GosmsConfig } from "./gosms";

export interface AuthorizedWebhook {
  userId: string;
  config: GosmsConfig;
}

/**
 * Najde uživatele jehož GoSMS webhookSecret odpovídá danému tokenu.
 * Vrací null pro neexistující/neplatný token (caller vrátí 401).
 *
 * Pozn.: webhookSecret je 24-byte base64url string z randomBytes — kolize
 * prakticky nemožná. Plain-text srovnání je OK (timing attack bezpředmětný
 * pro 192-bit secret).
 */
export async function authorizeWebhook(token: string | null): Promise<AuthorizedWebhook | null> {
  if (!token || token.length < 16) return null;

  // Single-user systém v praxi — projdeme všechny gosms integrace a porovnáme.
  // Při růstu přidat redundantní column webhookSecretPlain pro indexovaný lookup.
  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "gosms" },
    select: { userId: true, config: true },
  });

  for (const i of integrations) {
    const config = ((i.config as unknown) ?? {}) as GosmsConfig;
    if (config.webhookSecret && config.webhookSecret === token) {
      return { userId: i.userId, config };
    }
  }
  return null;
}

/**
 * Extrahuje gosmsMessageId z `links.message` URL např. "/api/v1/messages/542141883" → "542141883".
 */
export function extractGosmsMessageId(linksMessage: string | null | undefined): string | null {
  if (!linksMessage) return null;
  const m = linksMessage.match(/\/messages\/(\d+)/);
  return m ? m[1] : null;
}
