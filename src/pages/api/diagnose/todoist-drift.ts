import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { reconcileTodoistDrift } from "@/lib/todoist-reconcile";

export const prerender = false;

/**
 * GET /api/diagnose/todoist-drift?project=MEDIAFACE[&fix=1]
 * Porovná otevřené úkoly v DB s aktivními v Todoistu (per projekt) a řekne,
 * které jsou v Todoistu hotové / smazané / přesunuté. S fix=1 to opraví.
 * Bez project= projde všechny projekty (max 150 GET na stale položky).
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectName = url.searchParams.get("project") ?? undefined;
  const fix = url.searchParams.get("fix") === "1";
  const report = await reconcileTodoistDrift(session.uid, { projectName, fix });
  return Response.json({ ok: report.errors.length === 0, fix, ...report });
};
