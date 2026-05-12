#!/usr/bin/env tsx
/**
 * Pošta — RAG backfill historických mailů.
 *
 * Jednorázový skript pro embed celé historie EmailMessage (faze 4).
 * Cron `posta-embed` à 5 min indexuje JEN nové maily — pro existující
 * historii (před fází 4 deploy) je potřeba tento skript.
 *
 * Spuštění:
 *   npm run posta-backfill -- --confirm
 *   tsx scripts/posta-backfill.ts --confirm
 *
 * Bez --confirm skript jen vypíše "by zembedoval N mailů, použij --confirm".
 *
 * Vlastnosti:
 * - **Resumable** přes checkpoint v ./tmp/posta-backfill-state.json
 *   (id posledního zpracovaného mailu + timestamp). Po Ctrl+C lze restartovat,
 *   skript pokračuje od checkpoint.
 * - **Single instance lock** přes lock soubor ./tmp/posta-backfill.lock
 *   (PID + start time). Druhý spuštění zjistí běžící první → exit s erorem.
 * - **JSON progress log** každých 500 mailů → ./tmp/posta-backfill.log
 *   (jeden řádek = JSON s {at, processed, embedded, failed, durationMs}).
 * - **Dead letter queue**: chyby se ukládají do PostaEmbedFailure (DB),
 *   skript po dokončení vypíše souhrn.
 * - **Idempotent**: znovuspuštění s --confirm znovu projde, ale embedEmail()
 *   skipne maily co už mají embeddedAt (volá s force=false).
 *
 * Flag `--force` při znovuspuštění přepíše existující embeddings.
 * Flag `--user-id <id>` omezí na konkrétního uživatele (default: všichni
 * s Google integrací).
 * Flag `--limit <N>` omezí celkový počet zpracovaných mailů (default: bez limitu).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/db";
import { embedEmail } from "../src/lib/posta-embed";

const STATE_DIR = path.join(process.cwd(), "tmp");
const STATE_FILE = path.join(STATE_DIR, "posta-backfill-state.json");
const LOCK_FILE = path.join(STATE_DIR, "posta-backfill.lock");
const LOG_FILE = path.join(STATE_DIR, "posta-backfill.log");

const PROGRESS_LOG_EVERY = 500;

interface BackfillState {
  startedAt: string;
  lastProcessedEmailId: string | null;
  lastProcessedReceivedAt: string | null;
  userId: string | null;
  totalProcessed: number;
  totalEmbedded: number;
  totalSkipped: number;
  totalFailed: number;
}

interface BackfillOptions {
  confirm: boolean;
  force: boolean;
  userId: string | null;
  limit: number | null;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const opts: BackfillOptions = {
    confirm: false,
    force: false,
    userId: null,
    limit: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--confirm") opts.confirm = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--user-id") opts.userId = args[++i];
    else if (a === "--limit") opts.limit = parseInt(args[++i], 10);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
Pošta RAG backfill — embed historických mailů.

Usage:
  tsx scripts/posta-backfill.ts --confirm [options]

Options:
  --confirm           POVINNÝ flag, aby se neudělalo omylem
  --force             Reembed i emaily co už mají embeddedAt (default false)
  --user-id <id>      Omezit na konkrétního usera (default: všichni s Google)
  --limit <N>         Max počet mailů ke zpracování (default: bez limitu)
  --help, -h          Zobrazit tuto nápovědu

Resumable: po Ctrl+C lze restartovat, checkpoint v ./tmp/posta-backfill-state.json.

DLQ: chyby v PostaEmbedFailure tabulce. Skript po dokončení vypíše souhrn.
`);
}

async function main(): Promise<void> {
  const opts = parseArgs();

  await fs.mkdir(STATE_DIR, { recursive: true });

  // Single instance lock
  await acquireLock();

  try {
    // Najdi uživatele(e) k procesování
    const integrations = await prisma.userIntegration.findMany({
      where: opts.userId
        ? { provider: "google", userId: opts.userId }
        : { provider: "google" },
      select: { userId: true },
    });

    if (integrations.length === 0) {
      console.error("✗ Žádný uživatel s Google integrací nenalezen.");
      process.exit(1);
    }

    // Dry-run (bez --confirm)
    if (!opts.confirm) {
      console.log("DRY RUN — chybí --confirm. Statistika co by se stalo:\n");
      for (const i of integrations) {
        const where = opts.force
          ? { userId: i.userId, classification: { isNot: null } }
          : { userId: i.userId, embeddedAt: null, classification: { isNot: null } };
        const count = await prisma.emailMessage.count({ where });
        const totalCount = await prisma.emailMessage.count({ where: { userId: i.userId } });
        console.log(
          `  userId=${i.userId} candidates=${count}/${totalCount} (${opts.force ? "force=true" : "embeddedAt IS NULL"})`,
        );
      }
      console.log("\nPro spuštění přidej --confirm:");
      console.log("  tsx scripts/posta-backfill.ts --confirm");
      return;
    }

    // Skutečné zpracování
    const state = await loadOrInitState(opts.userId);
    state.startedAt = state.startedAt || new Date().toISOString();
    await saveState(state);

    console.log(`▶ Backfill start: ${integrations.length} user(s)`);
    if (state.totalProcessed > 0) {
      console.log(
        `  Resume z checkpoint: lastProcessedEmailId=${state.lastProcessedEmailId} totalProcessed=${state.totalProcessed}`,
      );
    }

    let globalProcessed = state.totalProcessed;
    let globalEmbedded = state.totalEmbedded;
    let globalSkipped = state.totalSkipped;
    let globalFailed = state.totalFailed;
    const startTime = Date.now();

    OUTER: for (const integration of integrations) {
      const userId = integration.userId;

      // Cursor pagination — ORDER BY receivedAt ASC, id ASC, postupně.
      // Pokud máme checkpoint pro tohoto usera, začneme za ním.
      let cursor: { receivedAt: Date; id: string } | null = null;
      if (state.userId === userId && state.lastProcessedReceivedAt && state.lastProcessedEmailId) {
        cursor = {
          receivedAt: new Date(state.lastProcessedReceivedAt),
          id: state.lastProcessedEmailId,
        };
      }

      while (true) {
        // Načti batch 100 mailů
        const where: Record<string, unknown> = {
          userId,
          classification: { isNot: null },
        };
        if (!opts.force) where.embeddedAt = null;
        if (cursor) {
          // Pokračovat za cursor (orderby receivedAt asc, id asc)
          where.OR = [
            { receivedAt: { gt: cursor.receivedAt } },
            { receivedAt: cursor.receivedAt, id: { gt: cursor.id } },
          ];
        }

        const batch = await prisma.emailMessage.findMany({
          where: where as never,
          select: { id: true, receivedAt: true },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          take: 100,
        });

        if (batch.length === 0) break;

        for (const email of batch) {
          if (opts.limit !== null && globalProcessed >= opts.limit) {
            console.log(`\n⏸ Limit ${opts.limit} dosažen. Stop.`);
            break OUTER;
          }

          const result = await embedEmail(email.id, { force: opts.force });
          globalProcessed++;
          if (result.ok && !result.skipped) globalEmbedded++;
          else if (result.skipped) globalSkipped++;
          else globalFailed++;

          // Update state
          state.lastProcessedEmailId = email.id;
          state.lastProcessedReceivedAt = email.receivedAt.toISOString();
          state.userId = userId;
          state.totalProcessed = globalProcessed;
          state.totalEmbedded = globalEmbedded;
          state.totalSkipped = globalSkipped;
          state.totalFailed = globalFailed;

          // Log + state save každých PROGRESS_LOG_EVERY mailů
          if (globalProcessed % PROGRESS_LOG_EVERY === 0) {
            await saveState(state);
            const elapsed = Date.now() - startTime;
            const rate = globalProcessed / (elapsed / 1000);
            await appendLog({
              at: new Date().toISOString(),
              processed: globalProcessed,
              embedded: globalEmbedded,
              skipped: globalSkipped,
              failed: globalFailed,
              durationMs: elapsed,
              rate: Number(rate.toFixed(2)),
            });
            console.log(
              `  [${globalProcessed}] embedded=${globalEmbedded} skipped=${globalSkipped} failed=${globalFailed} (${rate.toFixed(1)}/s, elapsed ${Math.floor(elapsed / 1000)}s)`,
            );
          }

          // Update cursor pro další batch
          cursor = { receivedAt: email.receivedAt, id: email.id };
        }
      }
    }

    // Konečné save state + log
    await saveState(state);
    const totalElapsed = Date.now() - startTime;
    await appendLog({
      at: new Date().toISOString(),
      processed: globalProcessed,
      embedded: globalEmbedded,
      skipped: globalSkipped,
      failed: globalFailed,
      durationMs: totalElapsed,
      done: true,
    });

    console.log(`\n✓ Backfill dokončen za ${(totalElapsed / 1000).toFixed(1)}s`);
    console.log(`  processed=${globalProcessed} embedded=${globalEmbedded} skipped=${globalSkipped} failed=${globalFailed}`);

    // DLQ souhrn
    const dlqCount = await prisma.postaEmbedFailure.count({
      where: opts.userId ? { userId: opts.userId } : {},
    });
    if (dlqCount > 0) {
      console.log(`\n⚠ Dead letter queue obsahuje ${dlqCount} záznamů.`);
      console.log("  Inspektuj přes: SELECT * FROM \"PostaEmbedFailure\" ORDER BY \"lastAttemptedAt\" DESC LIMIT 20;");
    }

    // Cleanup state file po úspěšném dokončení
    if (opts.limit === null) {
      await fs.unlink(STATE_FILE).catch(() => null);
    }
  } finally {
    await releaseLock();
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Lock + state helpery
// ---------------------------------------------------------------------------

async function acquireLock(): Promise<void> {
  try {
    const existing = await fs.readFile(LOCK_FILE, "utf8");
    const data = JSON.parse(existing) as { pid: number; startedAt: string };
    // Check, jestli ten PID stále běží
    try {
      process.kill(data.pid, 0); // signal 0 = check existence
      console.error(`✗ Backfill už běží: pid=${data.pid} startedAt=${data.startedAt}`);
      console.error(`  Pokud víš že proces je mrtvý: rm ${LOCK_FILE}`);
      process.exit(1);
    } catch {
      // Proces neexistuje — stale lock, smaž
      console.warn(`⚠ Stale lock (pid ${data.pid} neexistuje), přebírám.`);
      await fs.unlink(LOCK_FILE).catch(() => null);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // Lock soubor neexistuje — OK
  }
  await fs.writeFile(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    "utf8",
  );

  // Ensure release on signals
  const cleanup = async (): Promise<void> => {
    await releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function releaseLock(): Promise<void> {
  await fs.unlink(LOCK_FILE).catch(() => null);
}

async function loadOrInitState(userId: string | null): Promise<BackfillState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as BackfillState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return {
      startedAt: new Date().toISOString(),
      lastProcessedEmailId: null,
      lastProcessedReceivedAt: null,
      userId,
      totalProcessed: 0,
      totalEmbedded: 0,
      totalSkipped: 0,
      totalFailed: 0,
    };
  }
}

async function saveState(state: BackfillState): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function appendLog(entry: object): Promise<void> {
  await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
}

main().catch((e) => {
  console.error("✗ Backfill FAILED:", e instanceof Error ? e.stack : e);
  void releaseLock();
  void prisma.$disconnect();
  process.exit(1);
});
