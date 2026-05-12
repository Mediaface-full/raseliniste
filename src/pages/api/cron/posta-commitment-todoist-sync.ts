import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncPendingCommitments } from "@/lib/posta-commitment-sync";

export const prerender = false;

/**
 * Pošta — commitment Todoist sync catch-up (every 5 min, fáze 6).
 *
 * Jednosměrný sync DB → Todoist. Vytvoří úkoly pro auto-created
 * commitmenty, zavře resolved, smaže rejected/merged.
 * Rate limit: max 30 req/min do Todoist API.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "todoist" },
    select: { userId: true },
  });

  const results = [];
  for (const i of integrations) {
    const stats = await syncPendingCommitments(i.userId);
    results.push({
      userId: i.userId,
      created: stats.created,
      closed: stats.closed,
      deleted: stats.deleted,
      labeled: stats.labeled,
      errors: stats.errors,
      durationMs: stats.durationMs,
    });
  }

  return Response.json({ ok: true, users: results });
};
