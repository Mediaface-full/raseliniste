import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { readSession } from "@/lib/session";
import { dispatchScheduledJobs } from "@/lib/cron-dispatcher";

export const prerender = false;

/**
 * POST /api/cron/scheduler-run
 *
 * Authenticated trigger pro scheduler — Petr ho klikne ze /settings/crons,
 * žádný x-cron-key. Tělo identické s /api/cron/scheduler.
 *
 * Slouží pro debug a manuální spouštění když DSM Task Scheduler entry
 * neběží nebo Petr nechce čekat na další tick.
 *
 * `?dryRun=1` jako u public endpointu.
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });

  const dryRun = url.searchParams.get("dryRun") === "1";
  const baseUrl = process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";

  const summary = await dispatchScheduledJobs({
    baseUrl,
    cronKey: String(secret),
    dryRun,
  });

  return Response.json(summary);
};
