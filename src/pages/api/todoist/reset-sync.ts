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
 * se mirror naplní fresh stavem podle aktuálního Todoist obsahu.
 *
 * `?wipeTasks=1` (samostatný flag, NE součást ?hard=1): smaže Task rows
 * které jsou orphan (todoistTaskId IS NULL) a status='open'. Pro situaci
 * "Petr právě prochází migraci z Things, hard reset odpojil tasky od
 * Todoistu a před /things-import potřebuje čistý stav, jinak vznikne
 * duplikace". POZOR: tohle MAŽE Task data, je to destructive. Done tasks
 * a tasks napojené na Todoist (todoistTaskId NOT NULL) zůstávají.
 *
 * Lze kombinovat: ?hard=1&wipeTasks=1 (nejdřív hard reset = odpojí všechny
 * tasky → todoistTaskId NULL, pak wipe smaže ty open).
 *
 * POZOR: hard reset bez wipeTasks NEZASAHUJE Task obsah. Je to záměrná
 * pojistka — kdo si vzpomene jen na hard reset, neztratí svoje data.
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const hard = url.searchParams.get("hard") === "1";
  const wipeTasks = url.searchParams.get("wipeTasks") === "1";

  // Pure wipe-only path bez sync token resetu — Petr může zavolat ?wipeTasks=1
  // bez kombinace s hard, pokud ví co dělá. Ale typicky se volá po hard
  // resetu (tj. ?hard=1&wipeTasks=1) protože jen tak má dost orphan tasků.
  await prisma.user.update({
    where: { id: session.uid },
    data: { todoistSyncToken: null, todoistSyncError: null },
  });

  // SOFT only
  if (!hard && !wipeTasks) {
    return Response.json({
      ok: true,
      mode: "soft",
      note: "Sync token resetován. Příští /api/cron/todoist-sync udělá full snapshot — naimportuje VŠECHNY aktivní Todoist úkoly + projekty + labely. Stale entries v mirroru zůstávají.",
    });
  }

  // HARD RESET (volitelný) + WIPE ORPHAN TASKS (volitelný) — všechno
  // v jedné transakci ať je atomické (žádný half-state).
  const operations: Promise<unknown>[] = [];
  if (hard) {
    operations.push(
      prisma.todoistProjectMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.todoistLabelMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.task.updateMany({
        where: { userId: session.uid },
        data: { todoistProjectId: null, todoistTaskId: null, pushedAt: null, pushError: null },
      }),
    );
  }

  // wipeTasks musí běžet PO update Task (které nuluje todoistTaskId)
  // jinak by smazalo jen tasky které už byly orphan předtím. Při kombinaci
  // hard+wipe smaže VŠECHNY open (které hard udělal orphan). Bez hard smaže
  // jen ty co už byly orphan.
  let result;
  if (hard && wipeTasks) {
    // Sequential: nejdřív hard reset (3 ops), pak wipe na výsledku
    const [deletedProjects, deletedLabels, updatedTasks, deletedTasks] = await prisma.$transaction([
      prisma.todoistProjectMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.todoistLabelMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.task.updateMany({
        where: { userId: session.uid },
        data: { todoistProjectId: null, todoistTaskId: null, pushedAt: null, pushError: null },
      }),
      prisma.task.deleteMany({
        where: {
          userId: session.uid,
          todoistTaskId: null,
          status: "open",
        },
      }),
    ]);
    result = { deletedProjects: deletedProjects.count, deletedLabels: deletedLabels.count, updatedTasks: updatedTasks.count, deletedTasks: deletedTasks.count };
  } else if (hard) {
    const [deletedProjects, deletedLabels, updatedTasks] = await prisma.$transaction([
      prisma.todoistProjectMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.todoistLabelMirror.deleteMany({ where: { userId: session.uid } }),
      prisma.task.updateMany({
        where: { userId: session.uid },
        data: { todoistProjectId: null, todoistTaskId: null, pushedAt: null, pushError: null },
      }),
    ]);
    result = { deletedProjects: deletedProjects.count, deletedLabels: deletedLabels.count, updatedTasks: updatedTasks.count, deletedTasks: 0 };
  } else {
    // wipeTasks only
    const deletedTasks = await prisma.task.deleteMany({
      where: { userId: session.uid, todoistTaskId: null, status: "open" },
    });
    result = { deletedProjects: 0, deletedLabels: 0, updatedTasks: 0, deletedTasks: deletedTasks.count };
  }

  return Response.json({
    ok: true,
    mode: hard && wipeTasks ? "hard+wipe" : hard ? "hard" : "wipe",
    ...result,
    note: hard && wipeTasks
      ? "HARD RESET + WIPE hotov. Mirrory vyprázdněné, Task rows odpojené, orphan open Tasks smazány. Done tasks zachovány."
      : hard
        ? "HARD RESET hotov. Mirrory vyprázdněné, Task rows odpojené od Todoist ID. Existující Task rows zůstávají v DB."
        : `WIPE hotov. Smazáno ${result.deletedTasks} orphan open Tasků. Done tasks a tasks napojené na Todoist zůstaly.`,
  });
};
