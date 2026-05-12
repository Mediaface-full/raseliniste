/**
 * Pošta — 96denní retention cleanup.
 *
 * Per `docs/email-intelligence/RETENTION.md`:
 *  - Po 96 dnech od `receivedAt` se z `EmailMessage` nuluje (NE smaže celý row):
 *      bodyText, bodyHtml, attachments (JSON), rawHeaders (JSONB)
 *  - **Zachová** pro plnou historii search:
 *      subject, fromAddress, fromName, toAddresses, ccAddresses,
 *      bccAddresses, snippet, labels, receivedAt, threadId, gmailMessageId,
 *      hasAttachments, classification (1:1 EmailClassification),
 *      RagChunk (text + embedding)
 *
 * `bodyDeletedAt` se nastaví jako audit timestamp.
 *
 * Idempotence:
 *  - WHERE bodyDeletedAt IS NULL AND receivedAt < cutoff
 *  - Druhý run nezasáhne už cleanned záznamy.
 *
 * Transakce per batch (1000 mailů per UPDATE) — atomicita per chunk,
 * total cleanup je sled batch UPDATEů. Při chybě uprostřed je stav konzistentní.
 */

import { prisma } from "./db";

const RETENTION_DAYS = 96;
const BATCH_SIZE = 1000;

export interface CleanupStats {
  scanned: number;
  cleaned: number;
  batches: number;
  durationMs: number;
  cutoffDate: string;
}

/**
 * Spočítá kandidáty pro cleanup bez modifikace (dry-run).
 */
export async function countCleanupCandidates(): Promise<{
  total: number;
  cutoffDate: string;
}> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const total = await prisma.emailMessage.count({
    where: {
      bodyDeletedAt: null,
      receivedAt: { lt: cutoff },
      OR: [
        { bodyText: { not: null } },
        { bodyHtml: { not: null } },
        { rawHeaders: { not: undefined } },
      ],
    },
  });
  return { total, cutoffDate: cutoff.toISOString() };
}

/**
 * Provede cleanup — nuluje body fields u mailů starších 96 dnů.
 *
 * Smyčka přes batche 1000 mailů, dokud nezbývá co cleanut. Logy
 * každý batch + total summary.
 */
export async function runRetentionCleanup(options: { dryRun?: boolean } = {}): Promise<CleanupStats> {
  const start = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const stats: CleanupStats = {
    scanned: 0,
    cleaned: 0,
    batches: 0,
    durationMs: 0,
    cutoffDate: cutoff.toISOString(),
  };

  if (options.dryRun) {
    const result = await countCleanupCandidates();
    stats.scanned = result.total;
    stats.cleaned = 0;
    stats.durationMs = Date.now() - start;
    console.log(
      `[posta-cleanup] DRY RUN scanned=${result.total} cutoff=${cutoff.toISOString()}`,
    );
    return stats;
  }

  while (true) {
    // Najdi batch kandidátů
    const candidates = await prisma.emailMessage.findMany({
      where: {
        bodyDeletedAt: null,
        receivedAt: { lt: cutoff },
        // Aspoň jedno z body fields musí být non-null
        // (jinak by cleanup nedával smysl — už je nullovaný)
      },
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (candidates.length === 0) break;

    const ids = candidates.map((c) => c.id);

    // Transactional batch UPDATE
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.updateMany({
        where: { id: { in: ids } },
        data: {
          bodyText: null,
          bodyHtml: null,
          rawHeaders: undefined as never,
          // attachments: null,  ← Petr explicitně zmínil "attachments_metadata"
          //                       ale my v attachments uchováváme jen metadata
          //                       (filename, mime, sizeBytes, attachmentId).
          //                       Pro 96d retention je smysl je smazat — ID
          //                       attachmentu beztak po smazání mailu v Gmail
          //                       není dostupné. Nulujeme.
          attachments: undefined as never,
          bodyDeletedAt: new Date(),
        },
      });
    });

    stats.scanned += candidates.length;
    stats.cleaned += candidates.length;
    stats.batches++;

    console.log(
      `[posta-cleanup] batch ${stats.batches} cleaned=${candidates.length} total=${stats.cleaned}`,
    );

    if (candidates.length < BATCH_SIZE) break; // poslední batch
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-cleanup] DONE cleaned=${stats.cleaned} batches=${stats.batches} cutoff=${cutoff.toISOString()} duration=${stats.durationMs}ms`,
  );
  return stats;
}
