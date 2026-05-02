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
import { syncFetch, type TodoistSyncItem } from "./todoist";

export interface TodoistSyncStats {
  userId: string;
  ok: boolean;
  fullSync?: boolean;
  itemsReceived?: number;
  tasksCreated?: number;
  tasksUpdated?: number;
  tasksCompleted?: number;
  callLogsCompleted?: number;
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
  const d = new Date(due.date);
  if (isNaN(d.getTime())) return { dueAt: null, dueIsTime: false };
  return { dueAt: d, dueIsTime: hasTime };
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
    response = await syncFetch(token, startToken, ["items"]);
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
          completedAt?: Date;
          todoistProjectId: string;
        } = {
          title: item.content,
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
        await prisma.task.update({ where: { id: task.id }, data });
        stats.tasksUpdated!++;
        continue;
      }

      // 3. Nový task v Todoistu, kterého naše DB neviděla
      if (deleted) continue; // smazaný hned po vytvoření, neimportuj

      await prisma.task.create({
        data: {
          userId,
          title: item.content,
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
