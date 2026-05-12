import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { prisma } from "./db";
import { env } from "./env";
import { encryptSecret, decryptSecret } from "./crypto";

/**
 * Google OAuth 2.0 helper.
 * Refresh token uložen v UserIntegration(provider="google") šifrovaně
 * (stejný pattern jako Todoist — AES-256-GCM s klíčem ze SESSION_SECRET).
 *
 * Scopes:
 *   - https://www.googleapis.com/auth/calendar          (Calendar API r/w)
 *   - https://www.googleapis.com/auth/contacts.readonly (People API read)
 *
 * Access tokeny získáváme on-demand přes refresh — neukládáme.
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  // Pošta — fáze 1 (2026-05-12): readonly + metadata stačí pro import + klasifikaci.
  // Fáze 2+ rozšíří na gmail.modify (odpovídání, label changes).
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.metadata",
];

function requireEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google OAuth není nakonfigurovaný. Doplň GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET do .env.",
    );
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

/**
 * Vytvoří nový OAuth2Client (bez tokenů).
 */
export function makeOAuthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = requireEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Vrátí URL pro OAuth consent flow.
 * `state` parametr nese náhodný nonce, ověříme v callback.
 */
export function buildAuthUrl(state: string): string {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // důsledně si vyžádej refresh_token i opakovaně
    scope: GOOGLE_SCOPES,
    state,
  });
}

/**
 * Vyřeš code z callbacku → získej refresh token + uložit šifrovaně.
 */
export async function handleCallback(userId: string, code: string): Promise<void> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google nevrátil refresh_token. Zruš autorizaci v Google účtu a zkus znovu.");
  }
  const { enc, iv, tag } = encryptSecret(tokens.refresh_token);
  await prisma.userIntegration.upsert({
    where: { userId_provider: { userId, provider: "google" } },
    create: {
      userId,
      provider: "google",
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: {
        scopes: GOOGLE_SCOPES,
        connectedAt: new Date().toISOString(),
      },
      lastUsedAt: new Date(),
    },
    update: {
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: {
        scopes: GOOGLE_SCOPES,
        connectedAt: new Date().toISOString(),
      },
      lastError: null,
      lastUsedAt: new Date(),
    },
  });
}

/**
 * Vrátí authorized OAuth2Client pro daného uživatele
 * (s refresh tokenem nastaveným, automatický refresh access).
 */
export async function getAuthorizedClient(userId: string): Promise<OAuth2Client> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });
  if (!integration) {
    throw new Error("Google není připojený. Otevři Nastavení → Integrace → Google.");
  }
  const refreshToken = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Disconnect — smaž integraci v DB. Token v Google revokujeme volitelně.
 */
export async function disconnect(userId: string, alsoRevokeOnGoogle = true): Promise<void> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });
  if (!integration) return;

  if (alsoRevokeOnGoogle) {
    try {
      const refreshToken = decryptSecret({
        enc: integration.tokenEnc,
        iv: integration.tokenIv,
        tag: integration.tokenTag,
      });
      const client = makeOAuthClient();
      client.setCredentials({ refresh_token: refreshToken });
      await client.revokeCredentials().catch(() => null);
    } catch {
      // best effort
    }
  }

  await prisma.userIntegration.delete({ where: { id: integration.id } });
}

export async function isConnected(userId: string): Promise<{
  connected: boolean;
  lastUsedAt: Date | null;
  lastError: string | null;
  config: Record<string, unknown> | null;
}> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
    select: { lastUsedAt: true, lastError: true, config: true },
  });
  if (!integration) return { connected: false, lastUsedAt: null, lastError: null, config: null };
  return {
    connected: true,
    lastUsedAt: integration.lastUsedAt,
    lastError: integration.lastError,
    config: integration.config as Record<string, unknown> | null,
  };
}

export async function recordError(userId: string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  await prisma.userIntegration
    .updateMany({
      where: { userId, provider: "google" },
      data: { lastError: msg.slice(0, 1000) },
    })
    .catch(() => null);
}

export async function recordUsage(userId: string): Promise<void> {
  await prisma.userIntegration
    .updateMany({
      where: { userId, provider: "google" },
      data: { lastUsedAt: new Date(), lastError: null },
    })
    .catch(() => null);
}
