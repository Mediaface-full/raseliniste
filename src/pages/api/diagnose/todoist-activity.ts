import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { fetchTodoistActivity, getTodoistToken } from "@/lib/todoist-activity";

export const prerender = false;

/**
 * GET /api/diagnose/todoist-activity — ověření activity endpointu na produkci
 * (unified v1 docs neuvádí přesný tvar, klient probuje /activity | /activities
 * | /activity/get). Vrací prvních 5 normalizovaných eventů.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const token = await getTodoistToken(session.uid);
  if (!token) return Response.json({ error: "Todoist integrace není připojená." }, { status: 400 });

  try {
    const events = await fetchTodoistActivity(token, { limit: 5 });
    return Response.json({ ok: true, count: events.length, sample: events });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
};
