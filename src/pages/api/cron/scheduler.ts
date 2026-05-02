import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { dispatchScheduledJobs } from "@/lib/cron-dispatcher";

export const prerender = false;

/**
 * POST /api/cron/scheduler
 *
 * Auth: x-cron-key. JEDINÝ vnější cron entry v DSM Task Scheduler.
 * Schedule: každých 5 min.
 *
 * Iteruje přes CRON_JOBS (`src/lib/cron-schedule.ts`), pro každý job zjistí
 * match + idempotence, a pokud má běžet, zavolá interně příslušný endpoint
 * `/api/cron/<name>` přes localhost s `x-cron-key`.
 *
 * `?dryRun=1` — vrátí jen co BY se spustilo, nic neexecutuje. Užitečné
 * pro debug časování.
 *
 * `INTERNAL_BASE_URL` env (default `http://localhost:3000`) — adresa
 * pro vnitřní fetch volání. Používá se aplikační port uvnitř kontejneru,
 * ne externí port (3333).
 */
export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const dryRun = url.searchParams.get("dryRun") === "1";
  const baseUrl = process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";

  const summary = await dispatchScheduledJobs({
    baseUrl,
    cronKey: String(secret),
    dryRun,
  });

  return Response.json(summary);
};

// GET pro pohodlí — bez auth jen seznam definic, bez stavu (žádný leak).
export const GET: APIRoute = async () => {
  const { CRON_JOBS } = await import("@/lib/cron-schedule");
  return Response.json({
    count: CRON_JOBS.length,
    jobs: CRON_JOBS.map((j) => ({
      name: j.name,
      schedule: j.schedule,
      endpoint: j.endpoint,
      query: j.query,
      fireAndForget: j.fireAndForget ?? false,
      enabled: j.enabled !== false,
      description: j.description,
    })),
  });
};
