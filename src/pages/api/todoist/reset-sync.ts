import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/todoist/reset-sync
 *
 * Vyresetuje `User.todoistSyncToken` na `*` → příští volání todoist-sync
 * udělá full snapshot (všechny aktivní úkoly + projekty + labely se
 * naimportují / aktualizují). Použít když:
 *  - dropla se DB / migrace
 *  - sync se rozhasil (Petr chce čistý start)
 *  - prvotní setup (původně nikdy fullSync neproběhl)
 *
 * Pouze authenticated session.
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await prisma.user.update({
    where: { id: session.uid },
    data: { todoistSyncToken: null, todoistSyncError: null },
  });

  return Response.json({
    ok: true,
    note: "Sync token resetován. Příští /api/cron/todoist-sync udělá full snapshot — naimportuje VŠECHNY aktivní Todoist úkoly + projekty + labely.",
  });
};
