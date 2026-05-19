/**
 * TypeScript types pro Timeline View modul (F1).
 *
 * Petr 2026-05-19 — viz zadani-timeline-view.pdf § 2 (Datový model)
 * + design_tokens.md.
 *
 * Žádné Prisma model importy — frontend typy musí být deserializable
 * z JSON API response (Date jako string, pak parse v komponentě).
 */

export type Theme = "light" | "dark";

export type Zoom = "week" | "month" | "quarter";

export interface TimelineTeamMember {
  id: string;
  name: string;
  initial: string;          // pro avatar — typicky první písmeno
  colorIndex: number;       // index do PERSON_PALETTE (0-7)
  displayColor: string | null; // override (zatím vždy null, Q-F=B)
}

export interface TimelineSubproject {
  id: string;
  name: string;
  colorIndex: number;       // index do PERSON_PALETTE (sdílíme paletu)
}

export interface TimelineTask {
  id: string;
  title: string;
  notes: string | null;
  assigneeId: string;       // odkaz na TimelineTeamMember.id (nebo "owner" pro Petra)
  subprojectId: string;     // odkaz na TimelineSubproject.id
  startDate: string;        // ISO date YYYY-MM-DD
  durationDays: number;     // viz Q-G: priority Todoist duration → t-* tag → 1
  completed: boolean;
  todoistUrl: string | null; // odkaz do Todoist nebo null pokud nemá todoistTaskId
}

export interface TimelineMilestone {
  id: string;
  label: string;
  date: string;             // ISO YYYY-MM-DD
  subprojectId: string;
}

export interface TimelineProject {
  id: string;
  name: string;
  parentId: string | null;
  workspaceId: string | null;
  isTeamProject: boolean;
  subprojects: TimelineSubproject[];
  team: TimelineTeamMember[];
  tasks: TimelineTask[];
  milestones: TimelineMilestone[];
  startDate: string;        // ISO YYYY-MM-DD — auto vypočtená z min(tasks.startDate)
  endDate: string;          // ISO — auto z max(task end)
}

/** Seznam vybíratelných projektů pro dropdown v hero. */
export interface TimelineProjectOption {
  id: string;
  name: string;
  isParent: boolean;        // true pokud má sub-projekty
  subprojectCount: number;
  isTeamProject: boolean;
}
