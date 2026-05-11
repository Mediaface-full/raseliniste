import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { syncTodoistForUser } from "@/lib/todoist-sync";

export const prerender = false;

/**
 * POST /api/integrations/todoist/sync — manuální spuštění Todoist syncu
 * pro přihlášeného usera. Stejná logika jako cron job (každých 5 min),
 * ale on-demand. Vhodné když Petr právě vytvořil projekt v Todoistu
 * a chce ho hned vidět v TodoistProjectMirror (pre-flight check, dropdowny).
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const stats = await syncTodoistForUser(session.uid);
  if (!stats.ok) {
    return Response.json({ ok: false, error: stats.error ?? "Sync selhal." }, { status: 500 });
  }
  return Response.json({ ok: true, stats });
};
