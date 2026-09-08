import { prisma } from "./db";
import { filterTasks, type TodoistActiveTask } from "./todoist";

/**
 * Gideon 2026-09-08: na dashboardu místo notifikací aktivní P1 úkoly
 * z Todoistu; když jich je míň než 3 (0, 1 nebo 2), doplní se P2.
 *
 * Živě přes filtr (mirror Task.priority slévá P1+P2 do „high"), cache 5 min,
 * timeout přes AbortSignal v call(). Při selhání fallback na mirror (high).
 */
export interface PriorityTask {
  id: string;
  title: string;
  priority: 1 | 2; // 1 = P1, 2 = P2 (uživatelské značení)
  dueDate: string | null;
  projectId: string | null;
  url: string;
}

const cache = new Map<string, { at: number; data: PriorityTask[]; source: "live" | "mirror" }>();
const TTL_MS = 5 * 60 * 1000;
const MIN_P1 = 3;

function fromTodoist(t: TodoistActiveTask, p: 1 | 2): PriorityTask {
  return {
    id: t.id,
    title: t.content,
    priority: p,
    dueDate: t.due?.date ?? null,
    projectId: t.project_id ?? null,
    url: t.url ?? `https://app.todoist.com/app/task/${t.id}`,
  };
}

export async function loadPriorityTasks(userId: string, token: string | null): Promise<{ tasks: PriorityTask[]; source: "live" | "mirror" | "none" }> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return { tasks: hit.data, source: hit.source };

  if (token) {
    try {
      const withDeadline = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Todoist timeout 6 s")), 6000))]);
      const p1 = (await withDeadline(filterTasks(token, "p1"))).filter((t) => !t.checked && !t.is_completed);
      let tasks = p1.map((t) => fromTodoist(t, 1));
      if (tasks.length < MIN_P1) {
        const p2 = (await withDeadline(filterTasks(token, "p2"))).filter((t) => !t.checked && !t.is_completed);
        tasks = tasks.concat(p2.map((t) => fromTodoist(t, 2)));
      }
      tasks.sort((a, b) => a.priority - b.priority || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
      cache.set(userId, { at: Date.now(), data: tasks, source: "live" });
      return { tasks, source: "live" };
    } catch (e) {
      console.warn("[todoist-priority] live fetch selhal, fallback mirror:", e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback: mirror (priority high = P1 i P2 sloučené)
  const rows = await prisma.task.findMany({
    where: { userId, status: "open", priority: "high", todoistTaskId: { not: null } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 12,
    select: { todoistTaskId: true, title: true, dueAt: true, todoistProjectId: true },
  });
  const tasks: PriorityTask[] = rows.map((r) => ({
    id: r.todoistTaskId!,
    title: r.title,
    priority: 1,
    dueDate: r.dueAt ? r.dueAt.toISOString().slice(0, 10) : null,
    projectId: r.todoistProjectId,
    url: `https://app.todoist.com/app/task/${r.todoistTaskId}`,
  }));
  cache.set(userId, { at: Date.now(), data: tasks, source: "mirror" });
  return { tasks, source: tasks.length ? "mirror" : "none" };
}
