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
import { encryptBody, isEncryptionEnabled, ensureEncryptionKeyRegistered } from "./email-body-crypto";

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
 *
 * Před 2026-05-13: hardcoded 100 (Faze 1 dev test). Petr 2026-05-13 nahlásil
 * "naclo se jen 100 mailů" — limit byl smyslem MVP test, ne production.
 *
 * Retention pro Pošta je 96 dnů (RETENTION.md), takže init musí pulnout
 * 96 dnů zpět; ne týden.
 *
 * INIT (první sync — user.gmailHistoryId == null):
 *   - 5000 mailů cap (typický inbox za 96d cca 1-5k mailů)
 *   - query newer_than:96d
 *   - serial fetch ~50ms/mail = 5000 * 50ms = 250s = ~4 min, v limitu cron
 *     scheduler 15min ticku
 *
 * INCREMENTAL (následující sync):
 *   - 200 mailů cap (1d traffic + safety)
 *   - query newer_than:1d
 */
const MAX_MESSAGES_PER_INIT_SYNC = 5000;
const MAX_MESSAGES_PER_INCREMENTAL_SYNC = 200;
const INIT_QUERY = "newer_than:96d";
const INCREMENTAL_QUERY = "newer_than:1d";

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

  // Faze 5: pri prvnim pouziti zaregistruj klic do EncryptionKey tabulky
  // (idempotent, lazy — zavola se i kdyz klic neni nakonfigurovany s tichym
  // fall-through na plain text storage)
  if (isEncryptionEnabled()) {
    await ensureEncryptionKeyRegistered().catch((e) => {
      console.warn(`[posta-sync] ensureEncryptionKeyRegistered failed: ${e instanceof Error ? e.message : e}`);
    });
  }

  try {
    // Krok 1: aktuální profile (historyId pro uložení po sync)
    const profile = await getProfile(userId);
    stats.emailAddress = profile.emailAddress;
    stats.historyIdAfter = profile.historyId;

    // Faze 6: ulož Petrovu email adresu (detector commitmentu potřebuje
    // "from = ja" filter pro outbound only). Idempotent — overwrite OK.
    if (profile.emailAddress) {
      await prisma.user
        .update({ where: { id: userId }, data: { gmailEmailAddress: profile.emailAddress } })
        .catch(() => null);
    }

    // Krok 2: získat seznam ID
    // INIT (gmailHistoryId == null): pull 96d historie do MAX_MESSAGES_PER_INIT_SYNC (5000)
    // INCREMENTAL: pull 1d do MAX_MESSAGES_PER_INCREMENTAL_SYNC (200)
    const q = stats.mode === "init" ? INIT_QUERY : INCREMENTAL_QUERY;
    const maxMessages =
      stats.mode === "init" ? MAX_MESSAGES_PER_INIT_SYNC : MAX_MESSAGES_PER_INCREMENTAL_SYNC;
    const idsToFetch: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined = undefined;
    while (idsToFetch.length < maxMessages) {
      const remaining = maxMessages - idsToFetch.length;
      const page = await listMessages(userId, {
        q,
        maxResults: Math.min(500, remaining), // Gmail API max per page = 500
        pageToken,
      });
      idsToFetch.push(...page.messages);
      if (!page.nextPageToken || page.messages.length === 0) break;
      pageToken = page.nextPageToken;
    }
    if (idsToFetch.length === maxMessages) {
      console.warn(
        `[posta-sync] userId=${userId} mode=${stats.mode} hit max ${maxMessages} (možná víc historie čeká, další cron tick pokračovat nebude — historyId se ukládá)`,
      );
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
    const { trackRelatedEmail } = await import("./posta-commitment-sync");
    for (const meta of toFetch) {
      try {
        const raw = await getMessage(userId, meta.id);
        const parsed = parseGmailMessage(raw);
        await upsertEmailMessage(userId, parsed);
        stats.imported++;
        // Faze 6: track related pro inbound maily (helper skipne outbound)
        const dbRow = await prisma.emailMessage.findUnique({
          where: { gmailMessageId: parsed.gmailMessageId },
          select: { id: true },
        });
        if (dbRow) {
          void trackRelatedEmail(dbRow.id).catch(() => null);
        }
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

// ===========================================================================
// BACKFILL — multi-tick zpetny import historie (1-6 let, metadata-only)
// ===========================================================================

/**
 * Jeden cron tick zpetneho importu — pull jednu page Gmail messages.list,
 * per-mail messages.get?format=metadata (no body), persist. Pokud nextPageToken,
 * ulozit a vratit { hasMore: true }; cron volá znova za 15 min.
 *
 * Po dokonceni nastavi gmailBackfillCompletedAt + invokes posta-fill-bodies cron
 * (zatim TBD — full body pull pro nesmazane maily po cleanup).
 *
 * Idempotent: existujici EmailMessage row se neprepise (upsert update jen labels).
 */
export interface BackfillTickStats {
  userId: string;
  ok: boolean;
  fetched: number;
  skipped: number;
  errors: number;
  hasMore: boolean;
  totalSoFar: number;
  durationMs: number;
  error?: string;
}

const BACKFILL_PAGE_SIZE = 500; // Gmail messages.list max per page
const BACKFILL_MAX_PER_TICK = 500; // jeden tick zpracuje 1 page = 500 mailu

export async function backfillMetadataTick(userId: string): Promise<BackfillTickStats> {
  const start = Date.now();
  const stats: BackfillTickStats = {
    userId,
    ok: false,
    fetched: 0,
    skipped: 0,
    errors: 0,
    hasMore: false,
    totalSoFar: 0,
    durationMs: 0,
  };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      gmailBackfillStartedAt: true,
      gmailBackfillCompletedAt: true,
      gmailBackfillYears: true,
      gmailBackfillPageToken: true,
      gmailBackfillTotalFetched: true,
    },
  });
  if (!user || !user.gmailBackfillStartedAt) {
    stats.error = "Backfill nebyl spušten (gmailBackfillStartedAt = null).";
    stats.durationMs = Date.now() - start;
    return stats;
  }
  if (user.gmailBackfillCompletedAt) {
    stats.error = "Backfill už je dokončený.";
    stats.durationMs = Date.now() - start;
    stats.ok = true;
    return stats;
  }

  const years = user.gmailBackfillYears ?? 6;
  const q = `newer_than:${years}y`;
  stats.totalSoFar = user.gmailBackfillTotalFetched;

  try {
    // Krok 1: pull jednu page IDs
    const page = await listMessages(userId, {
      q,
      maxResults: BACKFILL_PAGE_SIZE,
      pageToken: user.gmailBackfillPageToken ?? undefined,
    });

    if (page.messages.length === 0) {
      // Hotovo (nebo prazdne)
      await prisma.user.update({
        where: { id: userId },
        data: {
          gmailBackfillCompletedAt: new Date(),
          gmailBackfillPageToken: null,
          gmailBackfillError: null,
        },
      });
      stats.ok = true;
      stats.hasMore = false;
      stats.durationMs = Date.now() - start;
      console.log(`[posta-backfill] userId=${userId} DONE total=${stats.totalSoFar}`);
      return stats;
    }

    // Krok 2: filter existujici (skip)
    const existing = await prisma.emailMessage.findMany({
      where: {
        userId,
        gmailMessageId: { in: page.messages.map((m) => m.id) },
      },
      select: { gmailMessageId: true },
    });
    const existingSet = new Set(existing.map((e) => e.gmailMessageId));
    const toFetch = page.messages.filter((m) => !existingSet.has(m.id));
    stats.skipped = existing.length;

    // Krok 3: per-mail metadata-only fetch (rychlejsi nez full)
    const { getMessageMetadata } = await import("./gmail");
    for (const meta of toFetch) {
      try {
        const raw = await getMessageMetadata(userId, meta.id);
        const parsed = parseGmailMessage(raw); // funguje i bez body
        await upsertEmailMessage(userId, parsed);
        stats.fetched++;
        await sleep(40); // 25/s, pod Gmail quota
      } catch (err) {
        stats.errors++;
        console.warn(`[posta-backfill] msg=${meta.id} err=${err instanceof Error ? err.message : err}`);
      }
    }

    // Krok 4: ulozit pageToken pro dalsi tick (nebo null = hotovo)
    const newTotal = user.gmailBackfillTotalFetched + stats.fetched;
    if (page.nextPageToken) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          gmailBackfillPageToken: page.nextPageToken,
          gmailBackfillTotalFetched: newTotal,
          gmailBackfillError: null,
        },
      });
      stats.hasMore = true;
    } else {
      // Posledni page
      await prisma.user.update({
        where: { id: userId },
        data: {
          gmailBackfillPageToken: null,
          gmailBackfillCompletedAt: new Date(),
          gmailBackfillTotalFetched: newTotal,
          gmailBackfillError: null,
        },
      });
      stats.hasMore = false;
    }
    stats.totalSoFar = newTotal;
    stats.ok = true;

    console.log(
      `[posta-backfill] userId=${userId} tick fetched=${stats.fetched} skipped=${stats.skipped} errors=${stats.errors} total=${newTotal} hasMore=${stats.hasMore} duration=${Date.now() - start}ms`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.error = msg;
    await prisma.user.update({
      where: { id: userId },
      data: { gmailBackfillError: msg.slice(0, 1000) },
    }).catch(() => null);
    console.error(`[posta-backfill] userId=${userId} ERROR ${msg}`);
  }

  stats.durationMs = Date.now() - start;
  return stats;
}

/**
 * Start backfill — vola se z UI tlacitka v PostaIntegration.
 * Reset state + set startedAt + years preference. Pak cron `posta-backfill`
 * 15min tick volá `backfillMetadataTick` dokud `gmailBackfillCompletedAt` se
 * nenastavi.
 */
export async function startBackfill(userId: string, years: number | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailBackfillStartedAt: new Date(),
      gmailBackfillCompletedAt: null,
      gmailBackfillYears: years,
      gmailBackfillPageToken: null,
      gmailBackfillTotalFetched: 0,
      gmailBackfillError: null,
    },
  });
}

// ===========================================================================
// FILL BODIES — po cleanup doplneni plnych tel pro nesmazane metadata-only maily
// ===========================================================================

/**
 * Najde EmailMessage rows s prazdnym body (bodyText IS NULL AND bodyTextCiphertext IS NULL)
 * a doplni full content z Gmail API. Cron `posta-fill-bodies` 10min tick,
 * max 100 mailu per tick.
 *
 * Pouziti: po backfillMetadataTick + Petruv cleanup v /posta/uklid, zbyle maily
 * potrebuji bodyText pro klasifikaci/embedding/zobrazeni v UI.
 *
 * Vraci stats.fetched=N pokud N>0, nebo {done: true} pokud zadne pending.
 */
export interface FillBodiesStats {
  userId: string;
  ok: boolean;
  filled: number;
  errors: number;
  remaining: number;
  durationMs: number;
}

const FILL_BODIES_PER_TICK = 100;

export async function fillBodiesTick(userId: string): Promise<FillBodiesStats> {
  const start = Date.now();
  const stats: FillBodiesStats = {
    userId,
    ok: false,
    filled: 0,
    errors: 0,
    remaining: 0,
    durationMs: 0,
  };

  // Najdi metadata-only maily (bez body) seřazené od nejnovějších
  const pending = await prisma.emailMessage.findMany({
    where: {
      userId,
      bodyText: null,
      bodyTextCiphertext: null,
      bodyHtml: null,
      bodyHtmlCiphertext: null,
    },
    orderBy: { receivedAt: "desc" },
    take: FILL_BODIES_PER_TICK,
    select: { id: true, gmailMessageId: true },
  });

  if (pending.length === 0) {
    stats.ok = true;
    stats.remaining = 0;
    stats.durationMs = Date.now() - start;
    return stats;
  }

  for (const m of pending) {
    try {
      const raw = await getMessage(userId, m.gmailMessageId);
      const parsed = parseGmailMessage(raw);
      // Body fields z full fetch — update existing row
      const encEnabled = isEncryptionEnabled();
      const bodyTextPacket = encEnabled ? encryptBody(parsed.bodyText) : null;
      const bodyHtmlPacket = encEnabled ? encryptBody(parsed.bodyHtml) : null;
      await prisma.emailMessage.update({
        where: { id: m.id },
        data: {
          bodyText: encEnabled ? null : parsed.bodyText,
          bodyHtml: encEnabled ? null : parsed.bodyHtml,
          bodyTextCiphertext: bodyTextPacket?.ciphertext ?? null,
          bodyHtmlCiphertext: bodyHtmlPacket?.ciphertext ?? null,
          bodyEncryptionKeyId: encEnabled ? (bodyTextPacket?.keyId ?? bodyHtmlPacket?.keyId ?? null) : null,
          hasAttachments: parsed.hasAttachments,
          attachments: parsed.attachments.length > 0 ? (parsed.attachments as unknown as object) : undefined,
          rawHeaders: parsed.rawHeaders as unknown as object,
        },
      });
      stats.filled++;
      await sleep(50);
    } catch (err) {
      stats.errors++;
      console.warn(`[posta-fill-bodies] msg=${m.gmailMessageId} err=${err instanceof Error ? err.message : err}`);
    }
  }

  const remainingCount = await prisma.emailMessage.count({
    where: {
      userId,
      bodyText: null,
      bodyTextCiphertext: null,
      bodyHtml: null,
      bodyHtmlCiphertext: null,
    },
  });
  stats.remaining = remainingCount;
  stats.ok = true;
  stats.durationMs = Date.now() - start;

  console.log(
    `[posta-fill-bodies] userId=${userId} filled=${stats.filled} errors=${stats.errors} remaining=${remainingCount} duration=${stats.durationMs}ms`,
  );
  return stats;
}

async function upsertEmailMessage(userId: string, parsed: ParsedEmail): Promise<void> {
  // Faze 5: AES-256-GCM encryption pokud EMAIL_BODY_ENCRYPTION_KEY je v env.
  // Pokud klíč není (dev / pre-fáze-5 instance), zapadne zpět na plain bodyText/Html.
  const encEnabled = isEncryptionEnabled();
  const bodyTextPacket = encEnabled ? encryptBody(parsed.bodyText) : null;
  const bodyHtmlPacket = encEnabled ? encryptBody(parsed.bodyHtml) : null;

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
      // Encryption-aware: pokud klíč existuje, ukládáme do ciphertext sloupců.
      // Legacy bodyText/Html zůstávají null (encryption-migrate skript může
      // pozdě převést starý plain text).
      bodyText: encEnabled ? null : parsed.bodyText,
      bodyHtml: encEnabled ? null : parsed.bodyHtml,
      bodyTextCiphertext: bodyTextPacket?.ciphertext ?? null,
      bodyHtmlCiphertext: bodyHtmlPacket?.ciphertext ?? null,
      bodyEncryptionKeyId: encEnabled ? (bodyTextPacket?.keyId ?? bodyHtmlPacket?.keyId ?? null) : null,
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
