/**
 * GoSMS API klient.
 *
 * Doc: https://doc.gosms.eu/?lang=cs
 * Base URL: https://app.gosms.eu/api/
 *
 * Auth flow: OAuth2 client_credentials.
 *   GET /oauth/v2/token?client_id=...&client_secret=...&grant_type=client_credentials
 *   → { access_token, expires_in: 3600 }
 *
 * Token cache je per-user, module-level Map. Klíč = userId.
 * Token se reusne dokud nevyprší (s 60s safety bufferem).
 *
 * Credentials čteme z UserIntegration(provider="gosms"):
 *   tokenEnc/Iv/Tag = client_secret (encrypted)
 *   config.clientId = client_id (plain, není to skutečné secret)
 *   config.defaultChannel = number (default channel ID)
 *   config.webhookSecret = string (pro validaci webhooků)
 *   config.organization = { credit, currency, channels[] } (cache z /v1)
 */

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { normalizePhone } from "./phone";

const BASE_URL = "https://app.gosms.eu/api";

interface TokenCache {
  token: string;
  expiresAt: number; // Date.now() + (expires_in - 60) * 1000
}

const tokenCache = new Map<string, TokenCache>();

export interface GosmsCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GosmsChannel {
  id: number;
  name: string;
  sourceNumber: string;
}

export interface GosmsOrganization {
  currentCredit: number;
  invoicingType: "Prepaid" | "Postpaid";
  currency: "CZK" | "EUR";
  channels: GosmsChannel[];
}

export interface GosmsConfig {
  clientId?: string;
  defaultChannel?: number;
  webhookSecret?: string;
  organization?: GosmsOrganization;
  organizationFetchedAt?: string;
}

export interface SendSmsResult {
  gosmsMessageId: string;
  invalidRecipients: string[];
}

export interface GosmsMessageDetail {
  isDelivered: boolean;
  smsCount: number;
  deliveredSmsCount: number;
  recipients: {
    delivered?: Record<string, string>;
    undelivered?: Record<string, string>;
    delivering?: Record<string, unknown>;
    sent?: string[];
    notSent?: string[];
    invalid?: string[];
  };
}

/**
 * Načte credentials pro userId. Vrací null pokud uživatel GoSMS nenakonfigoval.
 */
export async function loadGosmsCredentials(
  userId: string,
): Promise<{ creds: GosmsCredentials; config: GosmsConfig } | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "gosms" } },
  });
  if (!integration) return null;

  const clientSecret = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
  const config = ((integration.config as unknown) ?? {}) as GosmsConfig;
  if (!config.clientId) return null;

  return {
    creds: { clientId: config.clientId, clientSecret },
    config,
  };
}

/**
 * Získá platný access token pro daného uživatele. Cache 1 h - 60 s.
 */
export async function getAccessToken(userId: string, creds: GosmsCredentials): Promise<string> {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const url = new URL(`${BASE_URL}/oauth/v2/token`);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("client_secret", creds.clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoSMS auth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (!data.access_token) {
    throw new Error("GoSMS auth: chybí access_token v odpovědi");
  }

  const expiresAt = Date.now() + Math.max(60, data.expires_in - 60) * 1000;
  tokenCache.set(userId, { token: data.access_token, expiresAt });
  return data.access_token;
}

/**
 * Zruší cached token (např. po regeneraci credentials).
 */
export function invalidateTokenCache(userId: string): void {
  tokenCache.delete(userId);
}

async function authorizedFetch(
  userId: string,
  creds: GosmsCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(userId, creds);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${BASE_URL}${path}`, { ...init, headers });
}

/**
 * Detail organizace — kredit + seznam komunikačních kanálů.
 * Volá se po uložení credentials a periodicky pro refresh.
 */
export async function getOrganization(
  userId: string,
  creds: GosmsCredentials,
): Promise<GosmsOrganization> {
  const res = await authorizedFetch(userId, creds, "/v1");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoSMS getOrganization failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as GosmsOrganization;
}

/**
 * Otestuje credentials: zkusí získat token + detail organizace.
 * Vrací { ok, error?, organization? } pro UI feedback.
 */
export async function testCredentials(
  creds: GosmsCredentials,
): Promise<{ ok: true; organization: GosmsOrganization } | { ok: false; error: string }> {
  // Použijeme dočasný "test" userId aby se cache nemíchala s reálnými.
  const tempUserId = `__test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const organization = await getOrganization(tempUserId, creds);
    return { ok: true, organization };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    tokenCache.delete(tempUserId);
  }
}

export interface SendSmsInput {
  /** E.164 nebo CZ-friendly číslo (777 123 456 → +420777123456). String, pole, nebo {groups, contacts, otherNumbers}. */
  to: string | string[];
  message: string;
  /** Channel ID. Pokud null, použije se config.defaultChannel. */
  channel?: number;
  /** ISO8601 string pro odložené odeslání (musí být v budoucnosti). */
  scheduledFor?: string;
  /** Pokud true, použije /messages/test (dry-run, neodečte kredit, nepošle skutečně). */
  dryRun?: boolean;
}

/**
 * Pošle SMS přes GoSMS API.
 *
 * Vrací gosmsMessageId (extrahované z `link: "api/v1/messages/{id}"`).
 * Caller je zodpovědný za update vlastní DB SmsMessage rowy.
 *
 * Throws při chybě (400/401/500) — chytat ve volajícím a logovat do SmsMessage.errorMessage.
 */
export async function sendSms(
  userId: string,
  creds: GosmsCredentials,
  config: GosmsConfig,
  input: SendSmsInput,
): Promise<SendSmsResult> {
  const channel = input.channel ?? config.defaultChannel;
  if (!channel) {
    throw new Error("GoSMS sendSms: chybí channel ID (ani v inputu, ani v config.defaultChannel)");
  }

  // Normalizace čísel
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const normalized: string[] = [];
  for (const raw of recipients) {
    const n = normalizePhone(raw);
    if (n) normalized.push(n);
    else throw new Error(`GoSMS sendSms: neplatné číslo "${raw}"`);
  }

  const body: Record<string, unknown> = {
    message: input.message,
    channel,
    recipients: normalized.length === 1 ? normalized[0] : normalized,
  };
  if (input.scheduledFor) {
    body.expectedSendStart = input.scheduledFor;
  }

  const path = input.dryRun ? "/v1/messages/test" : "/v1/messages";
  const res = await authorizedFetch(userId, creds, path, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoSMS sendSms failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    recipients?: { invalid?: Array<string | number> };
    link?: string;
  };

  // Extrakce ID z linku "api/v1/messages/542141883"
  const link = data.link ?? "";
  const match = link.match(/\/messages\/(\d+)/);
  const gosmsMessageId = match ? match[1] : "";

  const invalid = (data.recipients?.invalid ?? []).map((v) => String(v));

  return { gosmsMessageId, invalidRecipients: invalid };
}

/**
 * Detail zprávy — vč. doručenek per recipient.
 * Použité polling cronem (fallback když webhook nedorazí).
 */
export async function getMessage(
  userId: string,
  creds: GosmsCredentials,
  gosmsMessageId: string,
): Promise<GosmsMessageDetail> {
  const res = await authorizedFetch(userId, creds, `/v1/messages/${gosmsMessageId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoSMS getMessage failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as GosmsMessageDetail;
}

/**
 * Zruší naplánovanou zprávu (je-li ještě v pendingu).
 */
export async function cancelMessage(
  userId: string,
  creds: GosmsCredentials,
  gosmsMessageId: string,
): Promise<boolean> {
  const res = await authorizedFetch(userId, creds, `/v1/messages/${gosmsMessageId}`, {
    method: "DELETE",
  });
  return res.ok;
}

/**
 * Načte odpovědi přiřazené k dané zprávě (alternativa k webhook reply).
 */
export async function getReplies(
  userId: string,
  creds: GosmsCredentials,
  gosmsMessageId: string,
): Promise<unknown> {
  const res = await authorizedFetch(userId, creds, `/v1/messages/${gosmsMessageId}/replies`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoSMS getReplies failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return await res.json();
}
