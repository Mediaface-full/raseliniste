/**
 * Gmail API klient — vrstva nad googleapis/gmail.
 *
 * Pattern stejný jako src/lib/google-calendar.ts a google-people.ts:
 *   1. getAuthorizedClient(userId) z google-oauth.ts
 *   2. google.gmail({ version: "v1", auth: client })
 *   3. wrapper s withRetry pro 429/5xx
 *
 * Gmail API quota: 250 quota units / user / second (asi tak 50 list calls).
 * Rate limit: 429 → exponential backoff (1 s, 4 s, 16 s — 3 retries).
 *
 * Užívaná pole:
 *   - users.messages.list(q, pageToken, maxResults) — seznam ID
 *   - users.messages.get(id, format="full") — detail vč. body
 *   - users.history.list(startHistoryId) — incremental změny
 *   - users.getProfile() — pro získání aktuálního historyId při inicializaci
 */

import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient, recordError, recordUsage } from "./google-oauth";

const GMAIL_USER_ID = "me"; // vždy aktuální OAuth uživatel

export interface GmailListOptions {
  /** Max počet vrácených IDs (Gmail max 500 per page; my default 100) */
  maxResults?: number;
  /** Gmail search query — např. `"after:2026/05/01 -in:spam"` */
  q?: string;
  /** Pro paging — token z předchozí odpovědi */
  pageToken?: string;
  /** Pole labelů (např. `["INBOX"]`); default = celá schránka kromě SPAM/TRASH */
  labelIds?: string[];
  /** Default false; pokud true zahrne i Spam/Trash */
  includeSpamTrash?: boolean;
}

export interface GmailMessageListResult {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

/**
 * Retry wrapper s exponential backoff pro Gmail API volání.
 * Pokrývá 429 (rate limit), 5xx (transient), network errors.
 *
 * Nepokrývá 401/403/404 — ty hodíme rovnou (auth issue, neexistující resource).
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [0, 1000, 4000, 16000];
  let lastErr: unknown = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      console.log(`[gmail] retry ${label} attempt ${i + 1}/${delays.length} after ${delays[i]}ms`);
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = extractHttpStatus(e);
      // Non-retryable: auth, invalid params, not found
      if (status && [400, 401, 403, 404].includes(status)) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[gmail] ${label} attempt ${i + 1} failed (status=${status ?? "?"}): ${msg.slice(0, 200)}`,
      );
    }
  }
  throw lastErr;
}

function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: number; status?: number; response?: { status?: number } };
  return e.response?.status ?? e.code ?? e.status ?? null;
}

async function getGmail(userId: string): Promise<gmail_v1.Gmail> {
  const auth = await getAuthorizedClient(userId);
  return google.gmail({ version: "v1", auth });
}

/**
 * Vrátí profil schránky včetně `historyId` — slouží jako startovní bod pro
 * incremental sync. Voláme jednou při inicializaci, pak ukládáme do
 * `User.gmailHistoryId`.
 */
export async function getProfile(userId: string): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}> {
  try {
    const gmail = await getGmail(userId);
    const res = await withRetry("getProfile", () =>
      gmail.users.getProfile({ userId: GMAIL_USER_ID }),
    );
    await recordUsage(userId);
    return {
      emailAddress: res.data.emailAddress ?? "",
      messagesTotal: res.data.messagesTotal ?? 0,
      threadsTotal: res.data.threadsTotal ?? 0,
      historyId: String(res.data.historyId ?? ""),
    };
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Seznam ID + threadId zpráv. Pro fázi 1 voláme pro full sync s `q` filtrem
 * `"after:YYYY/MM/DD"` nebo bez query (= celá schránka).
 */
export async function listMessages(
  userId: string,
  options: GmailListOptions = {},
): Promise<GmailMessageListResult> {
  try {
    const gmail = await getGmail(userId);
    const res = await withRetry("listMessages", () =>
      gmail.users.messages.list({
        userId: GMAIL_USER_ID,
        maxResults: options.maxResults ?? 100,
        q: options.q,
        pageToken: options.pageToken,
        labelIds: options.labelIds,
        includeSpamTrash: options.includeSpamTrash ?? false,
      }),
    );
    await recordUsage(userId);
    return {
      messages: (res.data.messages ?? []).map((m) => ({
        id: m.id ?? "",
        threadId: m.threadId ?? "",
      })),
      nextPageToken: res.data.nextPageToken ?? null,
      resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
    };
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Detail zprávy s plným tělem.
 *
 * Vrací surová Gmail data (headers v poli, body jako base64url v parts).
 * Parsing do našeho EmailMessage tvaru je v `parseGmailMessage` níže.
 */
export async function getMessage(
  userId: string,
  messageId: string,
): Promise<gmail_v1.Schema$Message> {
  try {
    const gmail = await getGmail(userId);
    const res = await withRetry(`getMessage:${messageId}`, () =>
      gmail.users.messages.get({
        userId: GMAIL_USER_ID,
        id: messageId,
        format: "full",
      }),
    );
    await recordUsage(userId);
    return res.data;
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Lightweight fetch — jen headers + snippet (žádný bodyText/Html).
 * Použito pro backfill historie (6 let), kde nejdřív chceme přehled
 * od koho/kdy/co a teprve po cleanup spam doplníme bodies.
 *
 * Quota cost stejný jako getMessage full (5 units), ale response payload
 * je mnohem menší — Gmail nevrací base64 body.
 */
export async function getMessageMetadata(
  userId: string,
  messageId: string,
): Promise<gmail_v1.Schema$Message> {
  try {
    const gmail = await getGmail(userId);
    const res = await withRetry(`getMessageMeta:${messageId}`, () =>
      gmail.users.messages.get({
        userId: GMAIL_USER_ID,
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID", "In-Reply-To", "References"],
      }),
    );
    await recordUsage(userId);
    return res.data;
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Bulk move messages to Trash. Gmail batchModify max 1000 ID per call.
 * Pouziva se v `/posta/uklid` cleanup UI.
 */
export async function trashMessages(userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  if (messageIds.length > 1000) throw new Error("trashMessages: max 1000 IDs per call");
  try {
    const gmail = await getGmail(userId);
    await withRetry(`trashMessages:${messageIds.length}`, () =>
      gmail.users.messages.batchModify({
        userId: GMAIL_USER_ID,
        requestBody: {
          ids: messageIds,
          addLabelIds: ["TRASH"],
          removeLabelIds: ["INBOX", "UNREAD"],
        },
      }),
    );
    await recordUsage(userId);
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

// =============================================================================
// Parsing helpers — Gmail → naše EmailMessage tvar
// =============================================================================

export interface ParsedEmail {
  gmailMessageId: string;
  threadId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  labels: string[];
  hasAttachments: boolean;
  attachments: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    attachmentId: string;
  }>;
  rawHeaders: Record<string, string>;
  receivedAt: Date;
}

/**
 * Z Gmail API tvaru vyrobíme náš ParsedEmail.
 *
 * Pozor:
 *  - body je base64url enkódované v partu s mimeType "text/plain" nebo "text/html"
 *  - multipart/mixed má text/html v nested part
 *  - headers jsou pole {name, value} — sestavíme do Record
 *  - From: "Jan Novák <jan@example.com>" → fromName + fromAddress
 */
export function parseGmailMessage(raw: gmail_v1.Schema$Message): ParsedEmail {
  const headers = headersToRecord(raw.payload?.headers);

  // From parsing
  const fromHeader = headers["from"] ?? "";
  const { name: fromName, address: fromAddress } = parseAddressHeader(fromHeader);

  // To/Cc/Bcc
  const toAddresses = parseAddressListHeader(headers["to"]);
  const ccAddresses = parseAddressListHeader(headers["cc"]);
  const bccAddresses = parseAddressListHeader(headers["bcc"]);

  // Body extraction — walk payload tree
  const { bodyText, bodyHtml, attachments } = extractBodyAndAttachments(raw.payload);

  // Received timestamp — Gmail vrací internalDate jako string (epoch ms)
  const receivedAt = raw.internalDate
    ? new Date(Number(raw.internalDate))
    : new Date();

  return {
    gmailMessageId: raw.id ?? "",
    threadId: raw.threadId ?? "",
    fromAddress: fromAddress || fromHeader,
    fromName: fromName || null,
    toAddresses,
    ccAddresses,
    bccAddresses,
    subject: headers["subject"] ?? null,
    snippet: raw.snippet ?? null,
    bodyText: bodyText || null,
    bodyHtml: bodyHtml || null,
    labels: raw.labelIds ?? [],
    hasAttachments: attachments.length > 0,
    attachments,
    rawHeaders: headers,
    receivedAt,
  };
}

function headersToRecord(
  headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const h of headers) {
    if (h.name && h.value !== null && h.value !== undefined) {
      // case-insensitive header names → uložíme lowercase
      out[h.name.toLowerCase()] = h.value;
    }
  }
  return out;
}

/**
 * "Jan Novák <jan@example.com>" → { name: "Jan Novák", address: "jan@example.com" }
 * "jan@example.com"             → { name: "", address: "jan@example.com" }
 * "<jan@example.com>"           → { name: "", address: "jan@example.com" }
 */
export function parseAddressHeader(raw: string): { name: string; address: string } {
  if (!raw) return { name: "", address: "" };
  const trimmed = raw.trim();
  const m = trimmed.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (m) {
    return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  }
  // Bez angle brackets
  return { name: "", address: trimmed.toLowerCase() };
}

/**
 * "Jan <jan@example.com>, Karel <karel@example.com>" → ["jan@example.com", "karel@example.com"]
 *
 * Pozn.: jednoduchá implementace — Gmail headers obvykle splňují tento tvar.
 * Edge case (zavorky uvnitř display name) odepíšeme jako known limit.
 */
export function parseAddressListHeader(raw: string | undefined | null): string[] {
  if (!raw) return [];
  // Split na čárky NEMUSÍ být v dishylaynamesch. Pro fázi 1 přijatelný kompromis.
  return raw
    .split(",")
    .map((part) => parseAddressHeader(part).address)
    .filter(Boolean);
}

function extractBodyAndAttachments(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): {
  bodyText: string;
  bodyHtml: string;
  attachments: ParsedEmail["attachments"];
} {
  let bodyText = "";
  let bodyHtml = "";
  const attachments: ParsedEmail["attachments"] = [];

  function walk(part: gmail_v1.Schema$MessagePart | null | undefined): void {
    if (!part) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    const isAttachment =
      Boolean(part.filename) && part.filename !== "" && Boolean(part.body?.attachmentId);

    if (isAttachment) {
      attachments.push({
        filename: part.filename ?? "untitled",
        mimeType: part.mimeType ?? "application/octet-stream",
        sizeBytes: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId ?? "",
      });
      return;
    }

    if (mime === "text/plain" && part.body?.data) {
      bodyText += (bodyText ? "\n\n" : "") + decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data) {
      bodyHtml += (bodyHtml ? "\n" : "") + decodeBase64Url(part.body.data);
    } else if (part.parts) {
      for (const sub of part.parts) walk(sub);
    }
  }

  walk(payload);
  return { bodyText, bodyHtml, attachments };
}

function decodeBase64Url(data: string): string {
  // Gmail body je base64url-encoded (- místo +, _ místo /, žádný padding).
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}
