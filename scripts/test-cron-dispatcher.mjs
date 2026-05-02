#!/usr/bin/env node
// Sanity check pro src/lib/cron-dispatcher.ts — bez DB, bez fetch.
// Testuje jen čisté funkce matchesSchedule + idempotenceReason.
//
// Spusť: node scripts/test-cron-dispatcher.mjs

import { spawnSync } from "node:child_process";

const tsx = spawnSync("npx", ["tsx", "--eval", `
  import { matchesSchedule, idempotenceReason } from "./src/lib/cron-dispatcher.ts";

  let pass = 0, fail = 0;
  function assert(label, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      console.log("✓", label);
      pass++;
    } else {
      console.log("✗", label, "→ expected", expected, "got", actual);
      fail++;
    }
  }

  // === matchesSchedule ===
  // every:5min — vždy true (scheduler interval = 5)
  assert("every:5 @ 12:00", matchesSchedule(new Date(2026, 4, 2, 12, 0), { type: "every", minutes: 5 }), true);
  assert("every:5 @ 12:34", matchesSchedule(new Date(2026, 4, 2, 12, 34), { type: "every", minutes: 5 }), true);

  // every:15min — match na 0, 15, 30, 45 (slot 5min × 3)
  assert("every:15 @ 12:00", matchesSchedule(new Date(2026, 4, 2, 12, 0), { type: "every", minutes: 15 }), true);
  assert("every:15 @ 12:15", matchesSchedule(new Date(2026, 4, 2, 12, 15), { type: "every", minutes: 15 }), true);
  assert("every:15 @ 12:05", matchesSchedule(new Date(2026, 4, 2, 12, 5), { type: "every", minutes: 15 }), false);
  assert("every:15 @ 12:10", matchesSchedule(new Date(2026, 4, 2, 12, 10), { type: "every", minutes: 15 }), false);

  // every:30min — match na 0, 30
  assert("every:30 @ 12:00", matchesSchedule(new Date(2026, 4, 2, 12, 0), { type: "every", minutes: 30 }), true);
  assert("every:30 @ 12:30", matchesSchedule(new Date(2026, 4, 2, 12, 30), { type: "every", minutes: 30 }), true);
  assert("every:30 @ 12:15", matchesSchedule(new Date(2026, 4, 2, 12, 15), { type: "every", minutes: 30 }), false);
  assert("every:30 @ 12:45", matchesSchedule(new Date(2026, 4, 2, 12, 45), { type: "every", minutes: 30 }), false);

  // daily 07:00 — match v okně 06:57:30..07:02:30 (±2.5)
  assert("daily 07:00 @ 07:00", matchesSchedule(new Date(2026, 4, 2, 7, 0), { type: "daily", hour: 7, minute: 0 }), true);
  assert("daily 07:00 @ 06:55", matchesSchedule(new Date(2026, 4, 2, 6, 55), { type: "daily", hour: 7, minute: 0 }), false);
  assert("daily 07:00 @ 07:05", matchesSchedule(new Date(2026, 4, 2, 7, 5), { type: "daily", hour: 7, minute: 0 }), false);

  // daily 07:05
  assert("daily 07:05 @ 07:05", matchesSchedule(new Date(2026, 4, 2, 7, 5), { type: "daily", hour: 7, minute: 5 }), true);

  // daily 02:30
  assert("daily 02:30 @ 02:30", matchesSchedule(new Date(2026, 4, 2, 2, 30), { type: "daily", hour: 2, minute: 30 }), true);

  // monthly-last-day — duben má 30 dní
  assert("monthly-last-day @ 30.4.23:00", matchesSchedule(new Date(2026, 3, 30, 23, 0), { type: "monthly-last-day", hour: 23, minute: 0 }), true);
  assert("monthly-last-day @ 29.4.23:00", matchesSchedule(new Date(2026, 3, 29, 23, 0), { type: "monthly-last-day", hour: 23, minute: 0 }), false);

  // === idempotenceReason ===
  const now = new Date(2026, 4, 2, 12, 0);

  // every:30min — gap musí být alespoň 29 min (30 -1 tolerance)
  assert("every:30 idempot — null lastSuccess", idempotenceReason({ type: "every", minutes: 30 }, null, now), null);
  assert("every:30 idempot — před 31 min OK", idempotenceReason({ type: "every", minutes: 30 }, new Date(now.getTime() - 31*60_000), now), null);
  assert("every:30 idempot — před 5 min skip", typeof idempotenceReason({ type: "every", minutes: 30 }, new Date(now.getTime() - 5*60_000), now), "string");

  // daily — pokud lastSuccess je dnes, skip
  assert("daily idempot — dnes ráno skip", typeof idempotenceReason({ type: "daily", hour: 7, minute: 0 }, new Date(2026, 4, 2, 7, 5), now), "string");
  assert("daily idempot — včera OK", idempotenceReason({ type: "daily", hour: 7, minute: 0 }, new Date(2026, 4, 1, 7, 5), now), null);

  console.log(\`\\n=== \${pass}/\${pass+fail} OK \${fail > 0 ? "FAIL" : ""} ===\`);
  process.exit(fail > 0 ? 1 : 0);
`], { stdio: "inherit", cwd: process.cwd() });

process.exit(tsx.status ?? 1);
