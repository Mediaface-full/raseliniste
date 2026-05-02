import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncTodoistForUser, type TodoistSyncStats } from "@/lib/todoist-sync";

export const prerender = false;

/**
 * POST /api/cron/todoist-sync
 * Auth: x-cron-key
 * Schedule: every 30 min (DSM Task Scheduler)
 *
 * Pull změn z Todoistu zpět do naší DB:
 *   - Nové úkoly v Todoistu (vytvořené přímo v appce Todoist) → Task se source=todoist_pull
 *   - Odškrtnuté / smazané v Todoistu → Task.completedAt + CallLog.seenAt (VIP)
 *   - Update titulu / due date / labels — Todoist je zdroj pravdy
 *
 * Per-user incremental přes Todoist Sync API a sync_token.
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

  const results: TodoistSyncStats[] = [];
  for (const { userId } of integrations) {
    const stats = await syncTodoistForUser(userId);
    results.push(stats);
  }

  return Response.json({
    ok: true,
    syncedAt: new Date().toISOString(),
    users: results.length,
    results,
  });
};
