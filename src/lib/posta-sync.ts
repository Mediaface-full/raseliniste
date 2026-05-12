/**
 * Pošta sync — pull Gmail mailů do DB.
 *
 * Faze 1 strategie:
 *   1. Pokud User.gmailHistoryId je null → INIT sync (full pull max 100 mailů
 *      přes `users.messages.list?q="newer_than:7d"`). Po dokončení uložit
 *      aktuální historyId z `users.getProfile()`.
 *   2. Pokud existuje → INCREMENTAL sync přes `users.history.list` (TODO faze 2 —
 *      teď jednoduše dělat list s `q="newer_than:1d"` který chytí cokoliv nového).
 *
 * Idempotence: EmailMessage.gmailMessageId @unique → upsert by-id.
 * Druhý pokus o stejný mail = no-op (zachová importedAt z prvního).
 *
 * Strukturované logování:
 *   `[posta-sync] userId=X mode=init|incremental imported=N skipped=M errors=K duration=Yms`
 */

import { prisma } from "./db";
import {
  getProfile,
  listMessages,
  getMessage,
  parseGmailMessage,
  type ParsedEmail,
} from "./gmail";

export interface PostaSyncStats {
  userId: string;
  ok: boolean;
  mode: "init" | "incremental";
  imported: number;
  skipped: number; // už v DB
  errors: number;
  errorDetails: Array<{ gmailMessageId: string; error: string }>;
  durationMs: number;
  historyIdBefore: string | null;
  historyIdAfter: string | null;
  emailAddress?: string;
  error?: string;
}

/**
 * Maximum mailů co stáhneme za jednu synchronizaci.
 * Faze 1 hranice — viz Petrovo zadání („zaimportovaných posledních 100 mailů").
 */
const MAX_MESSAGES_PER_SYNC = 100;

/**
 * Sync Gmail pro daného uživatele. Vola se z cronu nebo manualne přes
 * `/api/cron/posta-sync` resp. `/api/integrations/google/posta-init`.
 */
export async function syncPostaForUser(userId: string): Promise<PostaSyncStats> {
  const start = Date.now();
  const stats: PostaSyncStats = {
    userId,
    ok: false,
    mode: "init",
    imported: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
    durationMs: 0,
    historyIdBefore: null,
    historyIdAfter: null,
  };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailHistoryId: true },
  });
  if (!user) {
    stats.error = "USER_NOT_FOUND";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  stats.historyIdBefore = user.gmailHistoryId;
  stats.mode = user.gmailHistoryId ? "incremental" : "init";

  try {
    // Krok 1: aktuální profile (historyId pro uložení po sync)
    const profile = await getProfile(userId);
    stats.emailAddress = profile.emailAddress;
    stats.historyIdAfter = profile.historyId;

    // Krok 2: získat seznam ID
    // Faze 1: pro INIT i INCREMENTAL používáme messages.list s q filtrem.
    // INIT pulluje newer_than:7d (max 100), INCREMENTAL newer_than:1d
    // (nezavislé na gmailHistoryId — to bude pro fázi 2 přes history.list).
    const q = stats.mode === "init" ? "newer_than:7d" : "newer_than:1d";
    const idsToFetch: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined = undefined;
    while (idsToFetch.length < MAX_MESSAGES_PER_SYNC) {
      const remaining = MAX_MESSAGES_PER_SYNC - idsToFetch.length;
      const page = await listMessages(userId, {
        q,
        maxResults: Math.min(100, remaining),
        pageToken,
      });
      idsToFetch.push(...page.messages);
      if (!page.nextPageToken || page.messages.length === 0) break;
      pageToken = page.nextPageToken;
    }

    if (idsToFetch.length === 0) {
      console.log(
        `[posta-sync] userId=${userId} mode=${stats.mode} no new messages, duration=${
          Date.now() - start
        }ms`,
      );
      await markSynced(userId, profile.historyId);
      stats.ok = true;
      stats.durationMs = Date.now() - start;
      return stats;
    }

    // Krok 3: vyfiltrovat ty co už máme v DB (skip)
    const existing = await prisma.emailMessage.findMany({
      where: {
        userId,
        gmailMessageId: { in: idsToFetch.map((m) => m.id) },
      },
      select: { gmailMessageId: true },
    });
    const existingSet = new Set(existing.map((e) => e.gmailMessageId));
    const toFetch = idsToFetch.filter((m) => !existingSet.has(m.id));
    stats.skipped = existing.length;

    // Krok 4: fetch full content per ID (Gmail API neumí batch fetch zpráv,
    // takže serialně. Při 100 mailech ~10-30 sekund). Mezi voláními sleep 50ms
    // proti rate limitu.
    for (const meta of toFetch) {
      try {
        const raw = await getMessage(userId, meta.id);
        const parsed = parseGmailMessage(raw);
        await upsertEmailMessage(userId, parsed);
        stats.imported++;
        await sleep(50);
      } catch (err) {
        stats.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        stats.errorDetails.push({ gmailMessageId: meta.id, error: msg.slice(0, 500) });
        console.warn(`[posta-sync] userId=${userId} message=${meta.id} failed: ${msg.slice(0, 200)}`);
      }
    }

    // Krok 5: ulož historyId jako kurzor pro příště
    await markSynced(userId, profile.historyId);

    stats.ok = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.error = msg;
    await prisma.user
      .update({ where: { id: userId }, data: { gmailSyncError: msg.slice(0, 1000) } })
      .catch(() => null);
    console.warn(`[posta-sync] userId=${userId} FAILED: ${msg.slice(0, 300)}`);
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-sync] userId=${userId} mode=${stats.mode} imported=${stats.imported} skipped=${stats.skipped} errors=${stats.errors} duration=${stats.durationMs}ms`,
  );
  return stats;
}

async function upsertEmailMessage(userId: string, parsed: ParsedEmail): Promise<void> {
  await prisma.emailMessage.upsert({
    where: { gmailMessageId: parsed.gmailMessageId },
    create: {
      userId,
      gmailMessageId: parsed.gmailMessageId,
      threadId: parsed.threadId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddresses: parsed.toAddresses,
      ccAddresses: parsed.ccAddresses,
      bccAddresses: parsed.bccAddresses,
      subject: parsed.subject,
      snippet: parsed.snippet,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      labels: parsed.labels,
      hasAttachments: parsed.hasAttachments,
      attachments: parsed.attachments.length > 0 ? (parsed.attachments as unknown as object) : undefined,
      rawHeaders: parsed.rawHeaders as unknown as object,
      receivedAt: parsed.receivedAt,
    },
    update: {
      // Při idempotentním re-importu obnovíme jen labels (Gmail je může změnit
      // — INBOX → archive, etc.) — zbytek je immutable.
      labels: parsed.labels,
    },
  });
}

async function markSynced(userId: string, historyId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailHistoryId: historyId,
      gmailSyncedAt: new Date(),
      gmailSyncError: null,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
