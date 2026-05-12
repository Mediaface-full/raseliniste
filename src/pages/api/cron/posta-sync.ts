import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncPostaForUser } from "@/lib/posta-sync";

export const prerender = false;

/**
 * Pošta — incremental sync cron (každých 15 min).
 *
 * Volaný dispatcherem (cron-schedule.ts) přes /api/cron/scheduler.
 *
 * Pro každého usera s `UserIntegration(provider="google")` spustí syncPosta.
 * Single-user instance v praxi = 1 iterace.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "google" },
    select: { userId: true },
  });

  const results = [];
  for (const i of integrations) {
    const stats = await syncPostaForUser(i.userId);
    results.push({
      userId: i.userId,
      ok: stats.ok,
      mode: stats.mode,
      imported: stats.imported,
      skipped: stats.skipped,
      errors: stats.errors,
      durationMs: stats.durationMs,
      error: stats.error,
    });
  }

  return Response.json({ ok: true, users: results });
};
