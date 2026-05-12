#!/usr/bin/env tsx
/**
 * Pošta — manuální spuštění retention cleanup (96 dní).
 *
 * Cron `posta-cleanup` běží automaticky denně 03:00. Tento skript je pro
 * ad-hoc spuštění (debugging, manuální force) bez čekání na cron okno.
 *
 * Usage:
 *   npm run posta:cleanup -- --dry-run
 *   npm run posta:cleanup -- --confirm
 *
 * --dry-run    Spočítá kandidáty bez modifikace
 * --confirm    Spustí skutečný cleanup
 * --help       Nápověda
 */

import { prisma } from "../src/lib/db";
import { runRetentionCleanup, countCleanupCandidates } from "../src/lib/posta-cleanup";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const confirm = args.includes("--confirm");
  const help = args.includes("--help") || args.includes("-h");

  if (help || (!dryRun && !confirm)) {
    console.log(`
Pošta retention cleanup — manuální spuštění.

Usage:
  npm run posta:cleanup -- --dry-run    # jen spočítat
  npm run posta:cleanup -- --confirm    # skutečný cleanup

Cron běží automaticky denně 03:00, tohle je pro ad-hoc test/debug.
`);
    process.exit(0);
  }

  try {
    if (dryRun) {
      const result = await countCleanupCandidates();
      console.log(`Kandidáti k cleanup: ${result.total}`);
      console.log(`Cutoff datum: ${result.cutoffDate}`);
      console.log(`\nPro spuštění: npm run posta:cleanup -- --confirm`);
      return;
    }

    const stats = await runRetentionCleanup();
    console.log(`\n✓ Cleanup hotový`);
    console.log(`  cleaned=${stats.cleaned} batches=${stats.batches} duration=${stats.durationMs}ms`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗ Cleanup FAILED:", e instanceof Error ? e.stack : e);
  void prisma.$disconnect();
  process.exit(1);
});
