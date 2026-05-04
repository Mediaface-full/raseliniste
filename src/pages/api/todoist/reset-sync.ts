import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/todoist/reset-sync
 *
 * Default (soft reset): vyresetuje `User.todoistSyncToken` → příští sync
 * udělá full snapshot (upsert všech aktivních úkolů + projektů + labelů).
 * Stale entries (smazané projekty/labely v Todoistu) zůstávají jako mrtvé
 * řádky v mirroru.
 *
 * `?hard=1`: kromě sync tokenu vymaže VŠECHNY mirror rows + vyresetuje
 * Task.todoistProjectId + Task.todoistTaskId na NULL. Po dalším cron ticku
 * se mirror naplní fresh stavem podle aktuálního Todoist obsahu. Pro fall-back
 * po situaci „v Todoist UI jsem smazal/archivoval projekty, chci čistou DB".
 *
 * POZOR: hard reset NEZASAHUJE existující Task rows v naší DB (Petr je
 * neztratí). Jen je odpojí od todoistTaskId/todoistProjectId. Pokud byly
 * v Todoistu, příští push je založí znovu jako nové úkoly (nový todoistTaskId).
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const hard = url.searchParams.get("hard") === "1";

  await prisma.user.update({
    where: { id: session.uid },
    data: { todoistSyncToken: null, todoistSyncError: null },
  });

  if (!hard) {
    return Response.json({
      ok: true,
      mode: "soft",
      note: "Sync token resetován. Příští /api/cron/todoist-sync udělá full snapshot — naimportuje VŠECHNY aktivní Todoist úkoly + projekty + labely. Stale entries v mirroru zůstávají.",
    });
  }

  // HARD RESET — vymaž mirrory a odpoj Task rows
  const [deletedProjects, deletedLabels, updatedTasks] = await prisma.$transaction([
    prisma.todoistProjectMirror.deleteMany({ where: { userId: session.uid } }),
    prisma.todoistLabelMirror.deleteMany({ where: { userId: session.uid } }),
    prisma.task.updateMany({
      where: { userId: session.uid },
      data: { todoistProjectId: null, todoistTaskId: null, pushedAt: null, pushError: null },
    }),
  ]);

  return Response.json({
    ok: true,
    mode: "hard",
    deletedProjects: deletedProjects.count,
    deletedLabels: deletedLabels.count,
    updatedTasks: updatedTasks.count,
    note: "HARD RESET hotov. Mirrory vyprázdněné, Task rows odpojené od Todoist ID. Příští cron tick udělá full snapshot. Existující Task rows zůstávají v DB. Pokud chceš znovu pushnout do Todoistu, použij Push tlačítko per řádek v /ukoly.",
  });
};
