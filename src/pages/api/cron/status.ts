import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { CRON_JOBS } from "@/lib/cron-schedule";

export const prerender = false;

/**
 * GET /api/cron/status
 *
 * Auth: session. Vrátí přehled posledního běhu scheduleru — kdy naposledy
 * doběhl jaký job, případné chyby. Slouží pro Dashboard a /start dlaždici.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const runs = await prisma.cronRun.findMany();
  const map = new Map(runs.map((r) => [r.jobName, r]));

  const jobs = CRON_JOBS.map((def) => {
    const r = map.get(def.name);
    return {
      name: def.name,
      description: def.description,
      schedule: def.schedule,
      enabled: def.enabled !== false,
      lastTriggeredAt: r?.lastTriggeredAt ?? null,
      lastSuccessAt: r?.lastSuccessAt ?? null,
      lastError: r?.lastError ?? null,
      lastDurationMs: r?.lastDurationMs ?? null,
      lastStatus: r?.lastStatus ?? null,
      runCount: r?.runCount ?? 0,
      successCount: r?.successCount ?? 0,
      errorCount: r?.errorCount ?? 0,
    };
  });

  // Souhrn nejnovějšího běhu scheduleru = max lastTriggeredAt napříč joby
  const latest = jobs.reduce<Date | null>((acc, j) => {
    if (!j.lastTriggeredAt) return acc;
    const d = new Date(j.lastTriggeredAt);
    return !acc || d > acc ? d : acc;
  }, null);

  // Nedávné chyby — joby s lastError ne-null
  const errors = jobs
    .filter((j) => j.lastError && j.lastSuccessAt && new Date(j.lastSuccessAt).getTime() < Date.now() - 60_000)
    .map((j) => ({ name: j.name, error: j.lastError, lastSuccessAt: j.lastSuccessAt }));

  return Response.json({
    schedulerLastRunAt: latest,
    jobsTotal: jobs.length,
    healthy: errors.length === 0,
    errors,
    jobs,
  });
};
