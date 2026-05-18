/**
 * Self-test pro Todoist Team Workspace helpers (Petr 2026-05-18 — Cesta B).
 *
 * Spuštění:
 *   npx tsx scripts/test-todoist-workspace.ts
 *
 * Žádný test runner — jednoduchý assertion + console output. PASS/FAIL counter.
 * Pure functions (decidePreferTeam, slugify) jdou testovat bez DB.
 * resolveClientProject vyžaduje Prisma + Todoist data — netestuje se zde.
 */

import { decidePreferTeam, slugify } from "../src/lib/todoist-workspace";

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, expected: unknown, actual: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

function expectEq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, label, expected, actual);
}

// =============================================================================
// decidePreferTeam — 8 scenárů z Petrovy tabulky
// =============================================================================
console.log("\n=== decidePreferTeam ===");

expectEq(decidePreferTeam(["klient-tk-stavby"]), true,
  "klient-* → true");

expectEq(decidePreferTeam(["prace", "t-30m"]), true,
  "prace bez klient-* → true (interní firemní)");

expectEq(decidePreferTeam(["vip"]), false,
  "vip → false");

expectEq(decidePreferTeam(["rodina", "matej"]), false,
  "rodina + matej → false");

expectEq(decidePreferTeam(["klient-radys", "vip"]), true,
  "klient-* + vip → true (klient má prioritu nad personal)");

expectEq(decidePreferTeam(["t-2h", "dum"]), false,
  "bez routing tagů (jen t-* + neurčité) → false (Personal default)");

expectEq(decidePreferTeam([]), false,
  "prázdné pole → false (default)");

expectEq(decidePreferTeam(["domov", "matej", "lide"]), false,
  "víc personal tagů → false");

// Edge cases
expectEq(decidePreferTeam(["klient-"]), false,
  "malformed klient- bez suffixu → false (ošetřeno length > prefix)");

expectEq(decidePreferTeam(["KLIENT-TK-STAVBY"]), true,
  "case-insensitive (uppercase klient- prefix)");

expectEq(decidePreferTeam(["  klient-tk-stavby  "]), true,
  "trimuje whitespace");

// =============================================================================
// slugify — diakritika, mezery, pomlčky, case
// =============================================================================
console.log("\n=== slugify ===");

expectEq(slugify("TK-STAVBY"), "tk-stavby",
  "uppercase s pomlčkou");

expectEq(slugify("AVe Comp"), "ave-comp",
  "camelcase + mezera");

expectEq(slugify("Kosmetika Capri"), "kosmetika-capri",
  "víceslovo");

expectEq(slugify("Pešata"), "pesata",
  "diakritika (š → s)");

expectEq(slugify("Bohemian Moldavite"), "bohemian-moldavite",
  "dvě slova bez diakritiky");

expectEq(slugify("Malý klienti"), "maly-klienti",
  "diakritika (ý → y)");

expectEq(slugify("   leading trailing   "), "leading-trailing",
  "trim + collapse spaces");

expectEq(slugify("a___b---c"), "a-b-c",
  "collapse non-alphanumeric");

// =============================================================================
// Summary
// =============================================================================
console.log(`\n=== Summary: ${pass} pass, ${fail} fail ===\n`);
process.exit(fail === 0 ? 0 : 1);
