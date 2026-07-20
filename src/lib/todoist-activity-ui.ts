// Sdílené UI mapování pro Todoist activity (dashboard karta + /todoist/aktivita)
import type { TodoistActivityEvent } from "./todoist-activity";

export function activityIcon(e: TodoistActivityEvent): string {
  if (e.objectType === "note" || e.objectType === "project_note") return "lucide:message-square";
  if (e.eventType === "completed") return "lucide:check-circle-2";
  if (e.eventType === "uncompleted") return "lucide:undo-2";
  if (e.eventType === "added") return "lucide:plus-circle";
  if (e.eventType === "deleted") return "lucide:trash-2";
  if (e.eventType === "updated") return "lucide:pencil";
  return "lucide:activity";
}

export function activityLabel(e: TodoistActivityEvent): string {
  const comment = e.objectType === "note" || e.objectType === "project_note";
  if (comment) return "komentář:";
  const obj =
    e.objectType === "item" ? "úkol"
    : e.objectType === "project" ? "projekt"
    : e.objectType === "section" ? "sekce"
    : e.objectType;
  const verb =
    e.eventType === "added" ? "přidán"
    : e.eventType === "completed" ? "dokončen"
    : e.eventType === "uncompleted" ? "obnoven"
    : e.eventType === "updated" ? "upraven"
    : e.eventType === "deleted" ? "smazán"
    : e.eventType;
  return `${obj} ${verb}:`;
}
