/**
 * Načítání dat pro Timeline View z Prisma (read-only).
 *
 * Petr 2026-05-19:
 * - Q-C = A: jen DB (TodoistProjectMirror + Task), žádné Todoist API calls
 * - Sync běží à 5 min, latence akceptovatelná
 * - Q-G: filtrujeme úkoly bez dueAt (patří do backlogu)
 */

import { prisma } from "@/lib/db";
import type {
  TimelineProject,
  TimelineProjectOption,
  TimelineSubproject,
  TimelineTeamMember,
  TimelineTask,
  TimelineMilestone,
} from "@/components/timeline/types";
import { toIsoDate, parseDurationDays, isMilestone, todayIso, addDays } from "./date-utils";
import { hashToColorIndex } from "./color-utils";

/**
 * Seznam projektů pro dropdown.
 *
 * Petr 2026-05-20 — rozšířeno o folder-aware:
 *   - Pro projekty s `folderId` vytvoříme **pseudo-option "📁 <folderName>"**
 *     která pokrývá všechny projekty stejné složky (Team Workspace folder).
 *   - Samostatné projekty (bez folder_id) jsou normální options
 *   - Sub-projekty (parentId != null) jsou stále skryté — agreguje je parent
 *
 * ID pseudo-folder option = `folder:<folderId>` (prefix pro routing).
 */
export async function listProjectOptions(userId: string): Promise<TimelineProjectOption[]> {
  const all = await prisma.todoistProjectMirror.findMany({
    where: { userId, isInbox: false },
    select: {
      todoistId: true,
      name: true,
      parentId: true,
      isTeamProject: true,
      folderId: true,
      folderName: true,
    },
    orderBy: [{ isTeamProject: "desc" }, { name: "asc" }],
  });

  const childCount = new Map<string, number>();
  for (const p of all) {
    if (p.parentId) {
      childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
    }
  }

  // Sgrupuj projekty per folder
  const foldersMap = new Map<string, { name: string; projects: typeof all }>();
  for (const p of all) {
    if (p.folderId) {
      const folderName = p.folderName ?? "(neznámá složka)";
      const entry = foldersMap.get(p.folderId) ?? { name: folderName, projects: [] };
      entry.projects.push(p);
      foldersMap.set(p.folderId, entry);
    }
  }

  const options: TimelineProjectOption[] = [];

  // 1. Folders jako pseudo-options (id = "folder:<folderId>")
  for (const [folderId, entry] of foldersMap) {
    options.push({
      id: `folder:${folderId}`,
      name: `📁 ${entry.name}`,
      isParent: true,
      subprojectCount: entry.projects.length,
      isTeamProject: entry.projects.some((p) => p.isTeamProject),
    });
  }

  // 2. Root projekty BEZ folder_id (samostatné)
  for (const p of all) {
    if (p.parentId !== null) continue; // sub-projekty pod parents skryté
    if (p.folderId) continue;          // už pokryto folder pseudo-option
    options.push({
      id: p.todoistId,
      name: p.name,
      isParent: (childCount.get(p.todoistId) ?? 0) > 0,
      subprojectCount: childCount.get(p.todoistId) ?? 0,
      isTeamProject: p.isTeamProject,
    });
  }

  // Sort: Team projekty první, pak folders, pak samostatné, abecedně
  options.sort((a, b) => {
    if (a.isTeamProject !== b.isTeamProject) return a.isTeamProject ? -1 : 1;
    return a.name.localeCompare(b.name, "cs");
  });

  return options;
}

/**
 * Načte kompletní TimelineProject pro zobrazení.
 *
 * Podporuje multi-select (Petr 2026-05-20 — Q-I follow-up): místo jednoho
 * todoistId přijímá pole. Pokud více, agreguje úkoly ze všech, název složený.
 */
export async function loadTimelineProject(
  userId: string,
  projectTodoistIdOrIds: string | string[],
): Promise<TimelineProject | null> {
  const rawIds = Array.isArray(projectTodoistIdOrIds) ? projectTodoistIdOrIds : [projectTodoistIdOrIds];
  if (rawIds.length === 0) return null;

  // Petr 2026-05-20: rozšiř "folder:<id>" tokeny na seznam todoistId všech
  // projektů v dané složce. Single project ID zůstávají jak jsou.
  const expandedIds: string[] = [];
  let virtualFolderName: string | null = null;
  for (const rawId of rawIds) {
    if (rawId.startsWith("folder:")) {
      const folderId = rawId.slice("folder:".length);
      const inFolder = await prisma.todoistProjectMirror.findMany({
        where: { userId, folderId },
        select: { todoistId: true, folderName: true },
      });
      if (inFolder.length === 0) continue;
      // Zapamatuj folder name pro virtuální projekt
      if (!virtualFolderName) virtualFolderName = inFolder[0]!.folderName ?? null;
      for (const p of inFolder) expandedIds.push(p.todoistId);
    } else {
      expandedIds.push(rawId);
    }
  }

  if (expandedIds.length === 0) return null;

  const parents = await prisma.todoistProjectMirror.findMany({
    where: { userId, todoistId: { in: expandedIds } },
    orderBy: { name: "asc" },
  });
  if (parents.length === 0) return null;

  // Pro každý parent najdi children
  const childrenAll = await prisma.todoistProjectMirror.findMany({
    where: { userId, parentId: { in: parents.map((p) => p.todoistId) } },
    orderBy: { name: "asc" },
  });

  // Sub-projekty — každý parent + jeho children (pokud jsou), nebo parent jako jediný
  const subprojects: TimelineSubproject[] = [];
  const projectIdsForTasks: string[] = [];
  for (const parent of parents) {
    const myChildren = childrenAll.filter((c) => c.parentId === parent.todoistId);
    if (myChildren.length > 0) {
      // Parent má skutečné sub-projekty
      for (const c of myChildren) {
        subprojects.push({
          id: c.todoistId,
          name: c.name,
          colorIndex: hashToColorIndex(c.todoistId),
        });
        projectIdsForTasks.push(c.todoistId);
      }
      projectIdsForTasks.push(parent.todoistId);
    } else {
      // Standalone — parent sám je sub-projekt
      subprojects.push({
        id: parent.todoistId,
        name: parent.name,
        colorIndex: hashToColorIndex(parent.todoistId),
      });
      projectIdsForTasks.push(parent.todoistId);
    }
  }

  // První parent (pro fallback subprojectId u úkolu co nemá nic jiného)
  const firstParent = parents[0]!;
  // Multi-select: vytvoř virtuální "project" se složeným názvem
  // Pokud byl input folder:X, použij folder name. Jinak seskládej jména.
  const combinedName = virtualFolderName
    ? `📁 ${virtualFolderName}`
    : (parents.length === 1 ? firstParent.name : parents.map((p) => p.name).join(" + "));
  const combinedId = rawIds.length === 1
    ? rawIds[0]!
    : rawIds.join(",");

  // Načti Tasks — JEN s dueAt (Q-G), status open nebo done (skipni cancelled)
  const tasksRaw = await prisma.task.findMany({
    where: {
      userId,
      todoistProjectId: { in: projectIdsForTasks },
      dueAt: { not: null },
      status: { in: ["open", "done"] },
    },
    select: {
      id: true,
      title: true,
      notes: true,
      dueAt: true,
      tags: true,
      status: true,
      todoistTaskId: true,
      todoistProjectId: true,
      assignedToContactId: true,
      assignedToContact: { select: { id: true, displayName: true, firstName: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  // Sestav team — unique assignees + owner fallback
  const teamMap = new Map<string, TimelineTeamMember>();
  // Owner (Petr) — default lane pro úkoly bez assignee
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  const ownerLabel = owner?.username ? owner.username[0]!.toUpperCase() : "P";
  const OWNER_ID = "__owner__";
  teamMap.set(OWNER_ID, {
    id: OWNER_ID,
    name: owner?.username ?? "Owner",
    initial: ownerLabel,
    colorIndex: 0, // peach pro Petra
    displayColor: null,
  });

  for (const t of tasksRaw) {
    if (t.assignedToContact && !teamMap.has(t.assignedToContact.id)) {
      const c = t.assignedToContact;
      const displayName = c.firstName?.trim() || c.displayName;
      teamMap.set(c.id, {
        id: c.id,
        name: displayName,
        initial: (displayName.trim()[0] ?? "?").toUpperCase(),
        colorIndex: hashToColorIndex(c.id),
        displayColor: null,
      });
    }
  }

  // Mapuj tasks na TimelineTask + milestones
  const tasks: TimelineTask[] = [];
  const milestones: TimelineMilestone[] = [];

  for (const t of tasksRaw) {
    if (!t.dueAt) continue; // safety (where už filtroval)
    const startIso = toIsoDate(t.dueAt);
    const assigneeId = t.assignedToContactId ?? OWNER_ID;
    const subprojectId = t.todoistProjectId ?? firstParent.todoistId;
    const todoistUrl = t.todoistTaskId
      ? `https://todoist.com/showTask?id=${t.todoistTaskId}`
      : null;

    if (isMilestone(t.tags)) {
      milestones.push({
        id: t.id,
        label: t.title,
        date: startIso,
        subprojectId,
      });
      continue;
    }

    const durationDays = parseDurationDays({ tags: t.tags });
    tasks.push({
      id: t.id,
      title: t.title,
      notes: t.notes,
      assigneeId,
      subprojectId,
      startDate: startIso,
      durationDays,
      completed: t.status === "done",
      todoistUrl,
    });
  }

  // Spočítej startDate / endDate — s pufrem ±2 týdny od reálných dat,
  // ale vždy včetně dneška (jinak today line uteče mimo viewport)
  const todayStr = todayIso();
  const allDates: string[] = [todayStr];
  for (const t of tasks) {
    allDates.push(t.startDate);
    allDates.push(addDays(t.startDate, t.durationDays - 1));
  }
  for (const m of milestones) allDates.push(m.date);

  allDates.sort();
  const minDate = allDates[0]!;
  const maxDate = allDates[allDates.length - 1]!;

  // Buffer 7 dní zpět, 14 dní dopředu
  const startDate = addDays(minDate, -7);
  const endDate = addDays(maxDate, 14);

  return {
    id: combinedId,
    name: combinedName,
    parentId: firstParent.parentId,
    workspaceId: firstParent.workspaceId,
    isTeamProject: parents.every((p) => p.isTeamProject),
    subprojects,
    team: Array.from(teamMap.values()),
    tasks,
    milestones,
    startDate,
    endDate,
  };
}
