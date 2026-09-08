import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { reconcileTodoistDrift } from "@/lib/todoist-reconcile";

export const prerender = false;

/**
 * POST /api/cron/todoist-reconcile — denně 03:30. Levný reconcile driftu
 * (1 list per projekt + GET jen pro stale), s opravou. Viz lib/todoist-reconcile.ts.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const integrations = await prisma.userIntegration.findMany({ where: { provider: "todoist" }, select: { userId: true } });
  const results = [];
  for (const { userId } of integrations) {
    const r = await reconcileTodoistDrift(userId, { fix: true, maxGets: 200 });
    results.push({ userId, fixed: r.fixed, stale: r.projects.reduce((a, p) => a + p.stale, 0), errors: r.errors.slice(0, 5) });
  }
  return Response.json({ ok: true, results });
};
