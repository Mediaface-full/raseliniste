/**
 * Todoist incremental sync — pull změn z Todoistu zpět do naší DB.
 *
 * Volá se z /api/cron/todoist-sync každých 30 min + on-demand z některých
 * pohledů (např. VIP /call-log/thanks).
 *
 * Strategie:
 *   1. Pro daného userId načti `User.todoistSyncToken` (default "*").
 *   2. Volej Todoist Sync API s ["items"] (úkoly) — vrátí jen změny od minula
 *      (nebo plný snapshot u prvního syncu / po vyresetování tokenu).
 *   3. Pro každý vrácený item rozhodni:
 *        - Existuje `Task` s `todoistTaskId === item.id`?  → update
 *        - Existuje `CallLog` s `todoistTaskId === item.id`?  → update seenAt
 *        - Jinak → vytvoř nový `Task` se source=todoist_pull
 *   4. Smazaný / completed item:
 *        - Task.completedAt = item.completed_at ?? now (pokud null)
 *        - CallLog.seenAt = item.completed_at ?? now (pokud null)
 *   5. Ulož `User.todoistSyncToken = response.sync_token`.
 *
 * Tón: bez výjimek nepadá — každý error per-user se uloží do User.todoistSyncError
 * a další uživatel se zpracuje. Cron loguje souhrn.
 */

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { syncFetch, getTask, type TodoistSyncItem } from "./todoist";

export interface TodoistSyncStats {
  userId: string;
  ok: boolean;
  fullSync?: boolean;
  itemsReceived?: number;
  tasksCreated?: number;
  tasksUpdated?: number;
  tasksCompleted?: number;
  callLogsCompleted?: number;
  reconciledClosed?: number; // VIP mise + tasky které byly v Todoistu odškrtnuty/smazány
  projectsReceived?: number;
  projectsUpserted?: number;
  labelsReceived?: number;
  labelsUpserted?: number;
  error?: string;
}

function parseTodoistDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseDue(due: TodoistSyncItem["due"]): { dueAt: Date | null; dueIsTime: boolean } {
  if (!due?.date) return { dueAt: null, dueIsTime: false };
  const hasTime = due.date.includes("T");

  if (hasTime) {
    // Datetime string (s časem) — parsuj jak je. Todoist dodá ISO 8601 s tz info,
    // pokud time-only bez tz, JS parsuje jako lokální (správně pro náš účel).
    const d = new Date(due.date);
    return isNaN(d.getTime()) ? { dueAt: null, dueIsTime: false } : { dueAt: d, dueIsTime: true };
  }

  // All-day datum "YYYY-MM-DD" — `new Date("2026-05-10")` parsuje jako UTC midnight,
  // což v Praze (UTC+2) zobrazí jako 9. května 02:00. Musíme sestavit lokální půlnoc.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.date);
  if (!m) return { dueAt: null, dueIsTime: false };
  const [, y, mo, d] = m;
  const localDate = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  return isNaN(localDate.getTime())
    ? { dueAt: null, dueIsTime: false }
    : { dueAt: localDate, dueIsTime: false };
}

function priorityFromTodoist(p: number | undefined): "low" | "normal" | "high" {
  // Todoist priority: 1 (default/low) … 4 (urgent)
  if (p === 4 || p === 3) return "high";
  if (p === 2) return "normal";
  return "low";
}

export async function syncTodoistForUser(userId: string): Promise<TodoistSyncStats> {
  const stats: TodoistSyncStats = {
    userId,
    ok: false,
    itemsReceived: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    tasksCompleted: 0,
    callLogsCompleted: 0,
    reconciledClosed: 0,
    projectsReceived: 0,
    projectsUpserted: 0,
    labelsReceived: 0,
    labelsUpserted: 0,
  };

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integration) {
    stats.error = "INTEGRATION_NOT_CONFIGURED";
    return stats;
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { todoistSyncToken: true },
  });
  const startToken = user?.todoistSyncToken ?? "*";

  let response;
  try {
    response = await syncFetch(token, startToken, ["items", "projects", "labels"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stats.error = msg;
    await prisma.user.update({
      where: { id: userId },
      data: { todoistSyncError: msg, todoistSyncedAt: new Date() },
    });
    return stats;
  }

  stats.fullSync = response.full_sync;
  const items = response.items ?? [];
  stats.itemsReceived = items.length;

  for (const item of items) {
    try {
      // 1. Najdi existující CallLog s tímto todoistTaskId
      const callLog = await prisma.callLog.findFirst({
        where: { userId, todoistTaskId: item.id },
        select: { id: true, seenAt: true },
      });

      const completed = item.checked === true || !!item.completed_at;
      const deleted = item.is_deleted === true;
      const completionTime = parseTodoistDate(item.completed_at) ?? (deleted || completed ? new Date() : null);

      if (callLog) {
        // VIP mise — propíšeme jen seenAt
        if ((completed || deleted) && !callLog.seenAt && completionTime) {
          await prisma.callLog.update({
            where: { id: callLog.id },
            data: { seenAt: completionTime },
          });
          stats.callLogsCompleted!++;
        }
        continue;
      }

      // 2. Najdi existující Task s tímto todoistTaskId
      const task = await prisma.task.findFirst({
        where: { userId, todoistTaskId: item.id },
        select: { id: true, completedAt: true },
      });

      const { dueAt, dueIsTime } = parseDue(item.due);

      // Defenzivní fallback — Todoist u smazaných/archivovaných itemů občas
      // vrací prázdný/null content; bez fallbacku by Prisma create spadl.
      const safeTitle = (typeof item.content === "string" && item.content.trim()) || "(bez názvu)";

      if (task) {
        // Update existujícího Task — Todoist je zdroj pravdy
        const data: {
          title: string;
          notes: string | null;
          dueAt: Date | null;
          dueIsTime: boolean;
          tags: string[];
          priority: "low" | "normal" | "high";
          status: "open" | "done" | "cancelled";
          completedAt?: Date | null;
          todoistProjectId: string;
        } = {
          title: safeTitle,
          notes: item.description?.trim() || null,
          dueAt,
          dueIsTime,
          tags: item.labels ?? [],
          priority: priorityFromTodoist(item.priority),
          status: deleted ? "cancelled" : (completed ? "done" : "open"),
          todoistProjectId: item.project_id,
        };
        if ((completed || deleted) && !task.completedAt && completionTime) {
          data.completedAt = completionTime;
          stats.tasksCompleted!++;
        }
        // Reopen v Todoistu — pokud item není completed/deleted ale my máme
        // completedAt set z předchozího cyklu, vyčistíme. Bez toho by stav
        // zůstal inkonzistentní mezi sync a reconcile pass.
        if (!completed && !deleted && task.completedAt) {
          data.completedAt = null;
        }
        await prisma.task.update({ where: { id: task.id }, data });
        stats.tasksUpdated!++;
        continue;
      }

      // 3. Nový task v Todoistu, kterého naše DB neviděla
      if (deleted) continue; // smazaný hned po vytvoření, neimportuj

      await prisma.task.create({
        data: {
          userId,
          title: safeTitle,
          notes: item.description?.trim() || null,
          dueAt,
          dueIsTime,
          tags: item.labels ?? [],
          priority: priorityFromTodoist(item.priority),
          status: completed ? "done" : "open",
          completedAt: completed ? completionTime : null,
          source: "todoist_pull",
          todoistTaskId: item.id,
          todoistProjectId: item.project_id,
          pushedAt: parseTodoistDate(item.added_at),
        },
      });
      stats.tasksCreated!++;
    } catch (e) {
      // Single-item failure — neukončuj celý sync, jen loguj
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[todoist-sync] item ${item.id} failed:`, msg);
    }
  }

  // === PROJECTS — upsert do TodoistProjectMirror ===
  const projects = response.projects ?? [];
  stats.projectsReceived = projects.length;
  for (const p of projects) {
    try {
      await prisma.todoistProjectMirror.upsert({
        where: { userId_todoistId: { userId, todoistId: p.id } },
        update: {
          name: p.name,
          color: p.color ?? null,
          isInbox: p.is_inbox_project ?? false,
          parentId: p.parent_id ?? null,
          syncedAt: new Date(),
        },
        create: {
          userId,
          todoistId: p.id,
          name: p.name,
          color: p.color ?? null,
          isInbox: p.is_inbox_project ?? false,
          parentId: p.parent_id ?? null,
        },
      });
      stats.projectsUpserted!++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[todoist-sync] project ${p.id} failed:`, msg);
    }
  }

  // === RECONCILE: porovnání naší DB se skutečným stavem v Todoistu ===
  //
  // KLÍČOVÉ: Todoist v1 GET /tasks/:id vrací 200 i pro completed tasky
  // (s field `is_completed: true`). 404 vrací JEN pro smazané (hard delete).
  // Tedy musíme kontrolovat is_completed flag, ne pouhou existenci.
  //
  // Stav v Todoistu:
  //   null (404)                → smazán → close u nás
  //   { is_completed: true }    → odškrtnut → close u nás
  //   { is_completed: false }   → aktivní → reopen u nás (pokud máme done)
  try {
    const callLogs = await prisma.callLog.findMany({
      where: { userId, wasVip: true, todoistTaskId: { not: null } },
      select: { id: true, todoistTaskId: true, seenAt: true },
    });
    const tasks = await prisma.task.findMany({
      where: { userId, todoistTaskId: { not: null } },
      select: { id: true, todoistTaskId: true, status: true },
    });

    function isClosedInTodoist(task: { is_completed?: boolean; checked?: boolean } | null): boolean {
      if (task === null) return true; // 404 = smazán
      return task.is_completed === true || task.checked === true;
    }

    for (const cl of callLogs) {
      if (!cl.todoistTaskId) continue;
      try {
        const task = await getTask(token, cl.todoistTaskId);
        const closedInTodoist = isClosedInTodoist(task);
        if (closedInTodoist && cl.seenAt === null) {
          // Todoist completed/deleted ALE u nás otevřené → propíšeme close
          await prisma.callLog.update({
            where: { id: cl.id },
            data: { seenAt: new Date() },
          });
          stats.reconciledClosed!++;
        } else if (!closedInTodoist && cl.seenAt !== null) {
          // Todoist aktivní ALE u nás zavřené → reopen detekován
          await prisma.callLog.update({
            where: { id: cl.id },
            data: { seenAt: null },
          });
          stats.reconciledClosed!++;
        }
      } catch (e) {
        console.warn(`[todoist-sync reconcile callLog ${cl.id}]`, e instanceof Error ? e.message : String(e));
      }
    }

    for (const t of tasks) {
      if (!t.todoistTaskId) continue;
      try {
        const task = await getTask(token, t.todoistTaskId);
        const closedInTodoist = isClosedInTodoist(task);
        if (closedInTodoist && t.status === "open") {
          await prisma.task.update({
            where: { id: t.id },
            data: { status: "done", completedAt: new Date() },
          });
          stats.reconciledClosed!++;
        } else if (!closedInTodoist && t.status === "done") {
          await prisma.task.update({
            where: { id: t.id },
            data: { status: "open", completedAt: null },
          });
          stats.reconciledClosed!++;
        }
      } catch (e) {
        console.warn(`[todoist-sync reconcile task ${t.id}]`, e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    console.warn(`[todoist-sync] reconcile pass failed:`, e instanceof Error ? e.message : String(e));
  }

  // === LABELS — upsert do TodoistLabelMirror ===
  const labels = response.labels ?? [];
  stats.labelsReceived = labels.length;
  for (const l of labels) {
    try {
      await prisma.todoistLabelMirror.upsert({
        where: { userId_todoistId: { userId, todoistId: l.id } },
        update: {
          name: l.name,
          color: l.color ?? null,
          syncedAt: new Date(),
        },
        create: {
          userId,
          todoistId: l.id,
          name: l.name,
          color: l.color ?? null,
        },
      });
      stats.labelsUpserted!++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[todoist-sync] label ${l.id} failed:`, msg);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      todoistSyncToken: response.sync_token,
      todoistSyncedAt: new Date(),
      todoistSyncError: null,
    },
  });

  await prisma.userIntegration.update({
    where: { id: integration.id },
    data: { lastUsedAt: new Date(), lastError: null },
  });

  stats.ok = true;
  return stats;
}
