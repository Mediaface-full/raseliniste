#!/usr/bin/env tsx
/**
 * Pošta — migrace existujících plain bodyText/bodyHtml do AES-256-GCM
 * encrypted ciphertext sloupců (fáze 5).
 *
 * Background:
 * Před fází 5 byly bodyText/Html ukládány jako plain text. Po nasazení
 * fáze 5 + EMAIL_BODY_ENCRYPTION_KEY se nové maily šifrují, ale stávající
 * řádky zůstávají s plain bodyText. Tento skript je migruje.
 *
 * Spuštění:
 *   npm run posta:encrypt-migrate -- --confirm
 *
 * Idempotence: SELECT WHERE bodyText IS NOT NULL AND bodyTextCiphertext IS NULL.
 * Druhý run nezasáhne už zmigrovaná data.
 *
 * Per batch transakční — pokud spadne uprostřed, stav je konzistentní
 * (nikdy nemáš plain + cipher zároveň pro stejný email).
 *
 * Flagy:
 *   --confirm   POVINNÝ proti omylnému spuštění
 *   --dry-run   Spočítá kandidáty bez modifikace
 *   --limit N   Max počet migrovaných (default: bez limitu)
 */

import { prisma } from "../src/lib/db";
import { encryptBody, isEncryptionEnabled, ensureEncryptionKeyRegistered } from "../src/lib/email-body-crypto";

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
  const help = args.includes("--help") || args.includes("-h");

  if (help || (!confirm && !dryRun)) {
    console.log(`
Pošta encrypt migrate — převod plain bodyText/Html na AES-256-GCM ciphertext.

Usage:
  npm run posta:encrypt-migrate -- --dry-run        # spocita kandidaty
  npm run posta:encrypt-migrate -- --confirm        # skutecna migrace
  npm run posta:encrypt-migrate -- --confirm --limit 1000  # batch

Pred spustenim: EMAIL_BODY_ENCRYPTION_KEY musi byt nakonfigurovany v .env
(64 hex znaku, vygeneruj 'openssl rand -hex 32').
`);
    process.exit(0);
  }

  if (!isEncryptionEnabled()) {
    console.error("✗ EMAIL_BODY_ENCRYPTION_KEY není nakonfigurovaný. Nastav v .env.");
    process.exit(1);
  }

  await ensureEncryptionKeyRegistered();

  try {
    // Spočítej kandidáty
    const total = await prisma.emailMessage.count({
      where: {
        AND: [
          { OR: [{ bodyText: { not: null } }, { bodyHtml: { not: null } }] },
          { bodyTextCiphertext: null, bodyHtmlCiphertext: null },
        ],
      },
    });

    console.log(`Kandidáti k zašifrování: ${total}`);

    if (dryRun) {
      console.log(`\nPro spuštění: npm run posta:encrypt-migrate -- --confirm`);
      return;
    }

    if (total === 0) {
      console.log("✓ Žádná data k migraci.");
      return;
    }

    let processed = 0;
    let encrypted = 0;
    const start = Date.now();

    while (true) {
      if (limit !== null && processed >= limit) {
        console.log(`\n⏸ Limit ${limit} dosažen. Stop.`);
        break;
      }

      const batch = await prisma.emailMessage.findMany({
        where: {
          AND: [
            { OR: [{ bodyText: { not: null } }, { bodyHtml: { not: null } }] },
            { bodyTextCiphertext: null, bodyHtmlCiphertext: null },
          ],
        },
        select: { id: true, bodyText: true, bodyHtml: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) break;

      for (const email of batch) {
        if (limit !== null && processed >= limit) break;

        const textPacket = encryptBody(email.bodyText);
        const htmlPacket = encryptBody(email.bodyHtml);
        const keyId = textPacket?.keyId ?? htmlPacket?.keyId ?? null;

        await prisma.emailMessage.update({
          where: { id: email.id },
          data: {
            bodyTextCiphertext: textPacket?.ciphertext ?? null,
            bodyHtmlCiphertext: htmlPacket?.ciphertext ?? null,
            bodyEncryptionKeyId: keyId,
            // Plain text nulujeme až po úspěchu (atomicita per update OK)
            bodyText: null,
            bodyHtml: null,
          },
        });

        processed++;
        encrypted++;
      }

      const elapsed = Date.now() - start;
      const rate = processed / (elapsed / 1000);
      console.log(`  [${processed}] encrypted=${encrypted} (${rate.toFixed(1)}/s)`);

      if (batch.length < BATCH_SIZE) break; // poslední batch
    }

    const totalElapsed = Date.now() - start;
    console.log(`\n✓ Migrace hotová za ${(totalElapsed / 1000).toFixed(1)}s`);
    console.log(`  processed=${processed} encrypted=${encrypted}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗ Encrypt-migrate FAILED:", e instanceof Error ? e.stack : e);
  void prisma.$disconnect();
  process.exit(1);
});
