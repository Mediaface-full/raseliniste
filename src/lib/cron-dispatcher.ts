/**
 * Cron dispatcher — heart of the scheduler.
 *
 * Pro každý job v CRON_JOBS rozhodne:
 *   1. Match: aktuální čas odpovídá schedule? (s tolerancí)
 *   2. Idempotence: nespustil se nedávno? (porovnání s CronRun.lastSuccessAt)
 *
 * Pokud oba ano → fetch interní endpoint s `x-cron-key`. Sbírá výsledky.
 *
 * Tolerance: scheduler běží každých 5 min, takže daily HH:MM dostane
 * toleranci ±2.5 min — match pokud aktuální okno 5min cyklu obsahuje HH:MM.
 */

import { prisma } from "./db";
import { env } from "./env";
import { CRON_JOBS, type CronJobDef, type Schedule } from "./cron-schedule";

const FIRE_AND_FORGET_TIMEOUT_MS = 2_000; // krátká pojistka, scheduler nesmí stát dlouho
const REGULAR_TIMEOUT_MS = 90_000;

export interface DispatchedJobResult {
  name: string;
  matched: boolean;
  ranNow: boolean;
  skippedReason?: string;
  status?: number;
  durationMs?: number;
  error?: string;
  fireAndForget?: boolean;
}

export interface DispatchSummary {
  startedAt: string;
  durationMs: number;
  jobsTotal: number;
  jobsMatched: number;
  jobsRan: number;
  jobsFailed: number;
  results: DispatchedJobResult[];
  dryRun: boolean;
}

function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(d);
  next.setDate(d.getDate() + 1);
  return next.getMonth() !== d.getMonth();
}

/**
 * Vrátí true pokud aktuální čas odpovídá schedule.
 *
 * `every` matchuje pokud minuty zaokrouhlené na 5 min slot odpovídají.
 * Idempotence (gap proti lastSuccessAt) řeší samostatně dispatcher.
 */
export function matchesSchedule(now: Date, schedule: Schedule, schedulerIntervalMin = 5): boolean {
  const m = now.getMinutes();
  const h = now.getHours();

  switch (schedule.type) {
    case "every": {
      // every:Nmin matchuje vždy pokud N <= scheduler interval (5 min default).
      // Pro N > scheduler interval: matchuje když current minute slot je dělitelný N.
      if (schedule.minutes <= schedulerIntervalMin) return true;
      // Slot reprezentuje běh scheduleru (každých 5 min): 0, 5, 10, ...
      // Job s every:30min běží na 0 a 30 (pokud scheduler je každých 5).
      const slot = Math.floor(m / schedulerIntervalMin) * schedulerIntervalMin;
      return slot % schedule.minutes === 0;
    }
    case "daily": {
      // Match pokud aktuální čas spadá do okna [target-2.5, target+2.5]
      const targetMin = schedule.hour * 60 + schedule.minute;
      const nowMin = h * 60 + m;
      const half = schedulerIntervalMin / 2;
      return Math.abs(nowMin - targetMin) <= half;
    }
    case "monthly-last-day": {
      if (!isLastDayOfMonth(now)) return false;
      const targetMin = schedule.hour * 60 + schedule.minute;
      const nowMin = h * 60 + m;
      const half = schedulerIntervalMin / 2;
      return Math.abs(nowMin - targetMin) <= half;
    }
  }
}

/**
 * Idempotence — vrátí null pokud job může běžet, jinak důvod proč ne.
 */
export function idempotenceReason(
  schedule: Schedule,
  lastSuccessAt: Date | null,
  now: Date,
): string | null {
  if (!lastSuccessAt) return null;
  switch (schedule.type) {
    case "every": {
      const minGap = schedule.minutes * 60_000 - 60_000; // -60s tolerance
      const gap = now.getTime() - lastSuccessAt.getTime();
      if (gap < minGap) return `posledně před ${Math.round(gap / 60_000)} min (čeká ${schedule.minutes})`;
      return null;
    }
    case "daily": {
      const sameDay =
        lastSuccessAt.getFullYear() === now.getFullYear() &&
        lastSuccessAt.getMonth() === now.getMonth() &&
        lastSuccessAt.getDate() === now.getDate();
      return sameDay ? "už dnes proběhl" : null;
    }
    case "monthly-last-day": {
      const sameMonth =
        lastSuccessAt.getFullYear() === now.getFullYear() &&
        lastSuccessAt.getMonth() === now.getMonth();
      return sameMonth ? "už tento měsíc proběhl" : null;
    }
  }
}

async function callEndpoint(job: CronJobDef, baseUrl: string, cronKey: string, signal: AbortSignal): Promise<{ status: number; body: string }> {
  const url = `${baseUrl}${job.endpoint}${job.query ? `?${job.query}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-cron-key": cronKey, "content-type": "application/json" },
    signal,
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, body: body.slice(0, 500) };
}

/**
 * Hlavní vstup pro `/api/cron/scheduler`.
 *
 * @param baseUrl   `http://localhost:3000` (přepisuje se přes INTERNAL_BASE_URL env).
 * @param cronKey   Sdílí se s endpointy jako x-cron-key.
 * @param dryRun    Pokud true, nic se nevolá — jen vyhodnotí match + idempotence.
 */
export async function dispatchScheduledJobs(opts: {
  baseUrl: string;
  cronKey: string;
  dryRun?: boolean;
  now?: Date;
}): Promise<DispatchSummary> {
  const startedAt = opts.now ?? new Date();
  const tStart = Date.now();
  const results: DispatchedJobResult[] = [];

  for (const job of CRON_JOBS) {
    if (job.enabled === false) {
      results.push({ name: job.name, matched: false, ranNow: false, skippedReason: "disabled" });
      continue;
    }

    const matched = matchesSchedule(startedAt, job.schedule);
    if (!matched) {
      results.push({ name: job.name, matched: false, ranNow: false });
      continue;
    }

    const runRecord = await prisma.cronRun.findUnique({ where: { jobName: job.name } });
    const skipReason = idempotenceReason(job.schedule, runRecord?.lastSuccessAt ?? null, startedAt);
    if (skipReason) {
      results.push({ name: job.name, matched: true, ranNow: false, skippedReason: skipReason });
      continue;
    }

    if (opts.dryRun) {
      results.push({ name: job.name, matched: true, ranNow: false, skippedReason: "dry-run" });
      continue;
    }

    // Triggered marker — okamžitě, kvůli idempotenci paralelních běhů.
    await prisma.cronRun.upsert({
      where: { jobName: job.name },
      update: { lastTriggeredAt: startedAt, runCount: { increment: 1 } },
      create: {
        jobName: job.name,
        lastTriggeredAt: startedAt,
        runCount: 1,
      },
    });

    const ctrl = new AbortController();
    const timeout = setTimeout(
      () => ctrl.abort(),
      job.fireAndForget ? FIRE_AND_FORGET_TIMEOUT_MS : REGULAR_TIMEOUT_MS,
    );
    const t0 = Date.now();

    if (job.fireAndForget) {
      // Spustíme volání bez čekání na response — scheduler dokončí rychle.
      // Job záznam se update-ne v background po doběhu.
      //
      // Petr 2026-05-19: ZÁSADNĚ NEPOSÍLAT ctrl.signal do callEndpoint!
      // AbortController.abort() po 2s by propagoval do fetch → request.signal
      // na serveru → Prisma vyhodí "This operation was aborted" v mid-sync.
      // Sync musí běžet volně, dispatcher se odpojí jen logicky (Promise
      // se vyřeší kdy chce). 2s timeout je teď JEN housekeeping na update
      // CronRun error, ne abort serveru.
      const noAbortSignal = new AbortController().signal; // never aborted
      callEndpoint(job, opts.baseUrl, opts.cronKey, noAbortSignal)
        .then(async ({ status }) => {
          clearTimeout(timeout);
          const ok = status >= 200 && status < 300;
          await prisma.cronRun.update({
            where: { jobName: job.name },
            data: {
              lastSuccessAt: ok ? new Date() : undefined,
              lastError: ok ? null : `HTTP ${status}`,
              lastStatus: status,
              lastDurationMs: Date.now() - t0,
              successCount: ok ? { increment: 1 } : undefined,
              errorCount: ok ? undefined : { increment: 1 },
            },
          });
        })
        .catch(async (e) => {
          clearTimeout(timeout);
          await prisma.cronRun.update({
            where: { jobName: job.name },
            data: {
              lastError: e instanceof Error ? e.message : String(e),
              lastDurationMs: Date.now() - t0,
              errorCount: { increment: 1 },
            },
          });
        });

      results.push({ name: job.name, matched: true, ranNow: true, fireAndForget: true });
      continue;
    }

    try {
      const { status } = await callEndpoint(job, opts.baseUrl, opts.cronKey, ctrl.signal);
      clearTimeout(timeout);
      const ok = status >= 200 && status < 300;
      await prisma.cronRun.update({
        where: { jobName: job.name },
        data: {
          lastSuccessAt: ok ? new Date() : undefined,
          lastError: ok ? null : `HTTP ${status}`,
          lastStatus: status,
          lastDurationMs: Date.now() - t0,
          successCount: ok ? { increment: 1 } : undefined,
          errorCount: ok ? undefined : { increment: 1 },
        },
      });
      results.push({
        name: job.name,
        matched: true,
        ranNow: true,
        status,
        durationMs: Date.now() - t0,
        error: ok ? undefined : `HTTP ${status}`,
      });
    } catch (e) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.cronRun.update({
        where: { jobName: job.name },
        data: {
          lastError: msg,
          lastDurationMs: Date.now() - t0,
          errorCount: { increment: 1 },
        },
      });
      results.push({
        name: job.name,
        matched: true,
        ranNow: true,
        durationMs: Date.now() - t0,
        error: msg,
      });
    }
  }

  void env; // kept for potential future env reads in dispatcher

  return {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - tStart,
    jobsTotal: CRON_JOBS.length,
    jobsMatched: results.filter((r) => r.matched).length,
    jobsRan: results.filter((r) => r.ranNow).length,
    jobsFailed: results.filter((r) => r.error).length,
    results,
    dryRun: opts.dryRun ?? false,
  };
}
