import { prisma } from "./db";
import { getTask, listActiveTasks } from "./todoist";
import { fetchOwnTodoistUserId, getTodoistToken } from "./todoist-activity";

/**
 * Reconcile driftu Todoist ↔ Task mirror (Gideon 2026-09-08: „jak to, že
 * MEDIAFACE má v Rašeliništi 47 otevřených, v Todoistu ~20?").
 *
 * Incremental Sync API občas změnu nedoručí (reset sync_tokenu = full sync
 * bez completed položek, přesun mezi projekty, smazání v týmovém workspace).
 * Per-task GET pro všechny open tasky byl vypnutý (1500 requestů / 5 min →
 * 429 ban). Tady jdeme levně: 1 list aktivních úkolů per projekt (stránkovaně),
 * a GET jen pro ty, které v Todoistu aktivní NEJSOU (stale).
 *
 * Rozhodnutí per stale task:
 *   - GET 404               → v Todoistu smazaný → status cancelled
 *   - is_completed/checked  → hotový → status done + completedAt
 *   - jiný project_id       → přesunutý → update todoistProjectId (zůstává open)
 *   - jinak (aktivní, ale list ho neměl — např. stránkování) → nechat
 */
export interface DriftItem {
  taskId: string;
  todoistTaskId: string;
  title: string;
  verdict: "deleted" | "completed" | "moved" | "active";
  movedToProjectId?: string;
}

export interface DriftReport {
  projects: Array<{
    name: string; todoistId: string; dbOpen: number; liveActive: number; stale: number;
    /** Rozpad živého seznamu — proč Todoist v projektu „ukazuje míň": podúkoly jsou sbalené, cizí přiřazení jde odfiltrovat. */
    liveTopLevel: number; liveSubtasks: number; liveAssignedToOthers: number; liveUnassigned: number;
  }>;
  items: DriftItem[];
  fixed: { done: number; cancelled: number; moved: number };
  errors: string[];
}

export async function reconcileTodoistDrift(
  userId: string,
  opts: { projectName?: string; fix?: boolean; maxGets?: number } = {},
): Promise<DriftReport> {
  const report: DriftReport = { projects: [], items: [], fixed: { done: 0, cancelled: 0, moved: 0 }, errors: [] };
  const token = await getTodoistToken(userId);
  if (!token) { report.errors.push("Todoist integrace není připojená."); return report; }

  const mirrors = await prisma.todoistProjectMirror.findMany({
    where: {
      userId,
      ...(opts.projectName ? { name: { equals: opts.projectName, mode: "insensitive" } } : {}),
    },
    select: { todoistId: true, name: true },
  });
  if (mirrors.length === 0) { report.errors.push(opts.projectName ? `Projekt „${opts.projectName}" v mirroru není.` : "Žádné projekty v mirroru."); return report; }

  const maxGets = opts.maxGets ?? 150;
  let gets = 0;
  const ownId = await fetchOwnTodoistUserId(token).catch(() => null);

  for (const p of mirrors) {
    let live: Map<string, { project_id: string }>;
    let liveList: Awaited<ReturnType<typeof listActiveTasks>>;
    try {
      liveList = await listActiveTasks(token, p.todoistId);
      live = new Map(liveList.map((t) => [t.id, { project_id: t.project_id }]));
    } catch (e) {
      report.errors.push(`${p.name}: list selhal — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const dbOpen = await prisma.task.findMany({
      where: { userId, status: "open", todoistProjectId: p.todoistId, todoistTaskId: { not: null } },
      select: { id: true, todoistTaskId: true, title: true },
    });
    const stale = dbOpen.filter((t) => !live.has(t.todoistTaskId!));
    report.projects.push({
      name: p.name, todoistId: p.todoistId, dbOpen: dbOpen.length, liveActive: live.size, stale: stale.length,
      liveTopLevel: liveList.filter((t) => !t.parent_id).length,
      liveSubtasks: liveList.filter((t) => !!t.parent_id).length,
      liveAssignedToOthers: liveList.filter((t) => t.responsible_uid && ownId && t.responsible_uid !== ownId).length,
      liveUnassigned: liveList.filter((t) => !t.responsible_uid).length,
    });

    for (const t of stale) {
      if (gets >= maxGets) { report.errors.push(`Limit ${maxGets} GET dosažen — zbytek příště.`); break; }
      gets++;
      let item: DriftItem;
      try {
        const remote = await getTask(token, t.todoistTaskId!);
        const r = remote as unknown as { is_completed?: boolean; checked?: boolean; project_id?: string } | null;
        if (!r) item = { taskId: t.id, todoistTaskId: t.todoistTaskId!, title: t.title, verdict: "deleted" };
        else if (r.is_completed || r.checked) item = { taskId: t.id, todoistTaskId: t.todoistTaskId!, title: t.title, verdict: "completed" };
        else if (r.project_id && r.project_id !== p.todoistId) item = { taskId: t.id, todoistTaskId: t.todoistTaskId!, title: t.title, verdict: "moved", movedToProjectId: r.project_id };
        else item = { taskId: t.id, todoistTaskId: t.todoistTaskId!, title: t.title, verdict: "active" };
      } catch (e) {
        report.errors.push(`${t.title.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      report.items.push(item);
      if (!opts.fix) continue;
      try {
        if (item.verdict === "deleted") {
          await prisma.task.update({ where: { id: t.id }, data: { status: "cancelled", completedAt: new Date() } });
          report.fixed.cancelled++;
        } else if (item.verdict === "completed") {
          await prisma.task.update({ where: { id: t.id }, data: { status: "done", completedAt: new Date() } });
          report.fixed.done++;
        } else if (item.verdict === "moved" && item.movedToProjectId) {
          await prisma.task.update({ where: { id: t.id }, data: { todoistProjectId: item.movedToProjectId } });
          report.fixed.moved++;
        }
      } catch (e) {
        report.errors.push(`fix ${t.title.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return report;
}
