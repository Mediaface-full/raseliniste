import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { generateBriefing } from "@/lib/briefing";

export const prerender = false;

/**
 * POST /api/cron/nightly-briefing
 * Auth: x-cron-key
 * Schedule: 22:00 Europe/Prague (cron 0 22 * * *)
 *
 * Vygeneruje briefing pro ZÍTŘEK pro každého uživatele s Todoist integrací.
 * Idempotent (BriefingDigest.forDate má unique).
 *
 * Query param: ?date=YYYY-MM-DD pro override (např. backfill).
 *              ?force=1 pro přegenerování (smaže existující pro daný den).
 */
export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Default: zítřek
  const dateParam = url.searchParams.get("date");
  const force = url.searchParams.get("force") === "1";

  let forDate: Date;
  if (dateParam) {
    forDate = new Date(`${dateParam}T00:00:00`);
    if (isNaN(forDate.getTime())) {
      return Response.json({ error: "Invalid date param" }, { status: 400 });
    }
  } else {
    forDate = new Date();
    forDate.setDate(forDate.getDate() + 1);
    forDate.setHours(0, 0, 0, 0);
  }

  // Pro single-user systém: najdi všechny usery s Todoistem (ti dostanou push)
  // Pokud někdo Todoist nemá, briefing se uloží jen do DB.
  const users = await prisma.user.findMany({
    select: { id: true },
  });

  const results: Array<{
    userId: string;
    ok: boolean;
    digestId?: string;
    todoistTaskId?: string | null;
    skipped?: boolean;
    reason?: string;
    error?: string;
  }> = [];

  for (const u of users) {
    try {
      const r = await generateBriefing(u.id, forDate, { force, pushToTodoist: true });
      results.push({
        userId: u.id,
        ok: true,
        digestId: r.digestId,
        todoistTaskId: r.todoistTaskId,
        skipped: r.skipped,
        reason: r.reason,
      });
    } catch (e) {
      results.push({
        userId: u.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({ ok: true, forDate: forDate.toISOString().slice(0, 10), results });
};
