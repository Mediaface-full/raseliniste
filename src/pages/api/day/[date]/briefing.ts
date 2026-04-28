import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { generateBriefing } from "@/lib/briefing";

export const prerender = false;

/**
 * POST /api/day/:date/briefing
 * Body: { force?: boolean, push?: boolean }
 *
 * Manuální generování briefingu z UI (např. „Generovat teď" tlačítko).
 * Default: force=false (idempotent skip), push=true (do Todoistu).
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const dateStr = params.date as string | undefined;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return Response.json({ error: "Invalid date format" }, { status: 400 });
  }
  const forDate = new Date(`${dateStr}T00:00:00`);

  const body = await request.json().catch(() => ({}));
  const force = Boolean(body.force);
  const push = body.push !== false;

  try {
    const result = await generateBriefing(session.uid, forDate, { force, pushToTodoist: push });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
