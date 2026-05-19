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
 * Seznam projektů pro dropdown — parents + standalone (bez children).
 * Vrací JEN aktivní projekty (z mirroru, kde TodoistProjectMirror.isInbox=false).
 */
export async function listProjectOptions(userId: string): Promise<TimelineProjectOption[]> {
  const all = await prisma.todoistProjectMirror.findMany({
    where: { userId, isInbox: false },
    select: {
      todoistId: true,
      name: true,
      parentId: true,
      isTeamProject: true,
    },
    orderBy: [{ isTeamProject: "desc" }, { name: "asc" }],
  });

  // Spočti children per parent
  const childCount = new Map<string, number>();
  for (const p of all) {
    if (p.parentId) {
      childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
    }
  }

  // Filter: jen root (parentId=null) — to jsou "parent folders" nebo standalone
  return all
    .filter((p) => p.parentId === null)
    .map((p) => ({
      id: p.todoistId,
      name: p.name,
      isParent: (childCount.get(p.todoistId) ?? 0) > 0,
      subprojectCount: childCount.get(p.todoistId) ?? 0,
      isTeamProject: p.isTeamProject,
    }));
}

/**
 * Načte kompletní TimelineProject pro zobrazení.
 *
 * Algoritmus:
 *   1. Find parent projekt podle todoistId
 *   2. Find children (sub-projekty) podle parentId === parent.todoistId
 *   3. Pokud žádné children → "single mode" (fake jediný sub-projekt s názvem projektu)
 *   4. Načti Tasks s todoistProjectId IN (parent + children) AND dueAt IS NOT NULL
 *   5. Pro každý task vypočti durationDays (Q-G priority)
 *   6. Separuj tasks vs milestones (label "milestone")
 *   7. Sestav team z unique assignedToContact (+ owner=Petr fallback)
 *   8. startDate = min(tasks.dueAt) - 7 dní pufr, endDate = max(task end) + 14 dní pufr
 */
export async function loadTimelineProject(
  userId: string,
  projectTodoistId: string,
): Promise<TimelineProject | null> {
  const parent = await prisma.todoistProjectMirror.findFirst({
    where: { userId, todoistId: projectTodoistId },
  });
  if (!parent) return null;

  // Children pod tímto parentem (přes parentId match na todoistId)
  const children = await prisma.todoistProjectMirror.findMany({
    where: { userId, parentId: parent.todoistId },
    orderBy: { name: "asc" },
  });

  // Sub-projekty pro UI
  let subprojects: TimelineSubproject[];
  let projectIdsForTasks: string[];

  if (children.length > 0) {
    subprojects = children.map((c) => ({
      id: c.todoistId,
      name: c.name,
      colorIndex: hashToColorIndex(c.todoistId),
    }));
    projectIdsForTasks = [parent.todoistId, ...children.map((c) => c.todoistId)];
  } else {
    // Standalone projekt — fake "Realizace" sub-projekt = sám projekt
    subprojects = [{
      id: parent.todoistId,
      name: parent.name,
      colorIndex: hashToColorIndex(parent.todoistId),
    }];
    projectIdsForTasks = [parent.todoistId];
  }

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
    const subprojectId = t.todoistProjectId ?? parent.todoistId;
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
    id: parent.todoistId,
    name: parent.name,
    parentId: parent.parentId,
    workspaceId: parent.workspaceId,
    isTeamProject: parent.isTeamProject,
    subprojects,
    team: Array.from(teamMap.values()),
    tasks,
    milestones,
    startDate,
    endDate,
  };
}
