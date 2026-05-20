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

function parseDateString(dateStr: string): { dueAt: Date | null; dueIsTime: boolean } {
  const hasTime = dateStr.includes("T");
  if (hasTime) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? { dueAt: null, dueIsTime: false } : { dueAt: d, dueIsTime: true };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return { dueAt: null, dueIsTime: false };
  const [, y, mo, d] = m;
  const localDate = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  return isNaN(localDate.getTime())
    ? { dueAt: null, dueIsTime: false }
    : { dueAt: localDate, dueIsTime: false };
}

/**
 * Parse due s deadline fallbackem (Petr 2026-05-20):
 * Todoist má 2 koncepty datumu:
 *   - `due` = kdy úkol naplánován (Plánovač / "Today" filtr)
 *   - `deadline` = do kdy musí být hotový (nezahrnuto v "Today")
 *
 * Pro Timeline view potřebujeme alespoň jedno datum. Pokud due chybí ale
 * deadline existuje → použij deadline (úkol bude v timeline na deadline datum).
 */
function parseDue(item: { due?: TodoistSyncItem["due"]; deadline?: TodoistSyncItem["deadline"] }): {
  dueAt: Date | null;
  dueIsTime: boolean;
} {
  if (item.due?.date) {
    return parseDateString(item.due.date);
  }
  if (item.deadline?.date) {
    return parseDateString(item.deadline.date);
  }
  return { dueAt: null, dueIsTime: false };
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
    response = await syncFetch(token, startToken, ["items", "projects", "labels", "folders"]);
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

      const { dueAt, dueIsTime } = parseDue(item);

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
  // Folder lookup mapa pro persist project.folder_id → folder.name
  // (Petr 2026-05-20: Team Workspace folders místo sub-projektů)
  const foldersMap = new Map<string, string>();
  for (const f of response.folders ?? []) {
    foldersMap.set(f.id, f.name);
  }

  for (const p of projects) {
    try {
      const workspaceId = p.workspace_id ?? null;
      const isTeamProject = workspaceId !== null;
      const accessVisibility = p.access?.visibility ?? null;
      const folderId = p.folder_id ?? null;
      const folderName = folderId ? (foldersMap.get(folderId) ?? null) : null;

      await prisma.todoistProjectMirror.upsert({
        where: { userId_todoistId: { userId, todoistId: p.id } },
        update: {
          name: p.name,
          color: p.color ?? null,
          isInbox: p.is_inbox_project ?? false,
          parentId: p.parent_id ?? null,
          workspaceId,
          isTeamProject,
          accessVisibility,
          folderId,
          folderName,
          syncedAt: new Date(),
        },
        create: {
          userId,
          todoistId: p.id,
          name: p.name,
          color: p.color ?? null,
          isInbox: p.is_inbox_project ?? false,
          parentId: p.parent_id ?? null,
          workspaceId,
          isTeamProject,
          accessVisibility,
          folderId,
          folderName,
        },
      });
      stats.projectsUpserted!++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[todoist-sync] project ${p.id} failed:`, msg);
    }
  }

  // === RECONCILE: VYPNUTÉ (Petr 2026-05-19) ===
  //
  // Reconcile dělal `getTask(...)` per každý task v DB → s 1502 open tasks
  // znamená 1502+ jednotlivých API requestů per sync. Plus cron tick každých
  // 5 min → exponenciálně rostoucí 429 rate-limit ban (až 1280s retry-after).
  //
  // Sync API už VRACÍ completed/deleted flagy v response.items (is_deleted,
  // checked, completed_at). Reconcile přes per-task GET je redundantní —
  // klasická change-tracking pattern jsou v Sync API items[] z sync_token.
  //
  // Pokud bude potřeba full reconcile (data drift), udělat ho weekly cronem
  // s rate-limit awareness (max 100 req/min), ne v každém 5-min syncu.

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
