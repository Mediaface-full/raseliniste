import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { syncTodoistForUser } from "@/lib/todoist-sync";

export const prerender = false;

const Body = z.object({
  /**
   * Plný reset mirroru — smaže TodoistProjectMirror + TodoistLabelMirror + reset
   * sync_token, pak spustí čerstvý full sync. Použij když mirror obsahuje staré
   * smazané projekty (Sync API incremental vrací jen delta a smazané projekty
   * dříve než token nepromaže).
   */
  fullReset: z.boolean().optional(),
}).optional();

/**
 * POST /api/integrations/todoist/sync — manuální spuštění Todoist syncu
 * pro přihlášeného usera. Stejná logika jako cron job, ale on-demand.
 * Vhodné když Petr právě vytvořil projekt v Todoistu a chce ho hned vidět
 * v TodoistProjectMirror (pre-flight check, dropdowny).
 *
 * Volitelný body `{ fullReset: true }` — viz výše.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body> = undefined;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const raw = await request.json().catch(() => undefined);
      body = Body.parse(raw);
    }
  } catch {
    // Tělo nepovinné — chyba parsování ignorujeme, považujeme za bez body.
  }

  if (body?.fullReset) {
    await prisma.todoistProjectMirror.deleteMany({ where: { userId: session.uid } });
    await prisma.todoistLabelMirror.deleteMany({ where: { userId: session.uid } });
    await prisma.user.update({
      where: { id: session.uid },
      data: { todoistSyncToken: null, todoistSyncError: null },
    });
  }

  const stats = await syncTodoistForUser(session.uid);
  if (!stats.ok) {
    return Response.json({ ok: false, error: stats.error ?? "Sync selhal." }, { status: 500 });
  }
  return Response.json({ ok: true, stats, fullReset: Boolean(body?.fullReset) });
};
