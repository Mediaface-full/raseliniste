/**
 * Todoist Unified API v1 klient.
 * Dokumentace: https://developer.todoist.com/api/v1/
 *
 * (REST v2 endpoint byl v dubnu 2026 deprecated → 410 Gone.)
 *
 * Používáme:
 *  - GET /projects — list pro picker v settings (paginovaný: { results, next_cursor })
 *  - POST /tasks — vytvoření úkolu z call-log
 */

const BASE = "https://api.todoist.com/api/v1";

export interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id?: string | null;
  is_inbox_project?: boolean;
}

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id: string;
  priority: 1 | 2 | 3 | 4; // 1 = lowest, 4 = highest (urgent)
  url: string;
}

export interface CreateTaskInput {
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;  // Todoist ID rodičovského tasku → vytvoří se jako podúkol
  priority?: 1 | 2 | 3 | 4;
  due_string?: string; // "today", "tomorrow at 9am", ...
  due_date?: string;   // "YYYY-MM-DD" — přesné datum, přebíjí due_string
  labels?: string[];
}

export interface TodoistSection {
  id: string;
  name: string;
  project_id: string;
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Todoist ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listProjects(token: string): Promise<TodoistProject[]> {
  // v1 vrací { results: [...], next_cursor: string|null }
  // Procházíme stránky dokud je cursor. Max 500 projektů stačí pro běžný účet.
  const all: TodoistProject[] = [];
  let cursor: string | null = null;
  type Page = { results: TodoistProject[]; next_cursor: string | null };
  for (let i = 0; i < 10; i++) {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page: Page = await call<Page>(token, `/projects${query}`);
    if (Array.isArray(page)) return page as unknown as TodoistProject[];
    if (!page?.results) break;
    all.push(...page.results);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}

export async function createTask(token: string, input: CreateTaskInput): Promise<TodoistTask> {
  return call<TodoistTask>(token, "/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Get single task by ID. Vrací null pokud task neexistuje (404 = completed/deleted).
 * Užitečné pro reconcile open VIP misí — Sync API completed tasky nevrací.
 */
export async function getTask(token: string, taskId: string): Promise<TodoistTask | null> {
  try {
    return await call<TodoistTask>(token, `/tasks/${encodeURIComponent(taskId)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404/.test(msg)) return null;
    throw e;
  }
}

/**
 * Mark task as completed (close). Todoist v1: POST /tasks/:id/close
 * Idempotent — pokud je už closed, nehází chybu.
 */
export async function closeTask(token: string, taskId: string): Promise<void> {
  await call<void>(token, `/tasks/${encodeURIComponent(taskId)}/close`, { method: "POST" });
}

/**
 * Reopen previously closed task. Todoist v1: POST /tasks/:id/reopen
 */
export async function reopenTask(token: string, taskId: string): Promise<void> {
  await call<void>(token, `/tasks/${encodeURIComponent(taskId)}/reopen`, { method: "POST" });
}

/**
 * Hard delete task. Todoist v1: DELETE /tasks/:id
 * Pokud task neexistuje (404), ignoruj — idempotent.
 */
export async function deleteTask(token: string, taskId: string): Promise<void> {
  try {
    await call<void>(token, `/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404/.test(msg)) return; // už neexistuje, OK
    throw e;
  }
}

export async function createProject(
  token: string,
  input: string | { name: string; parentId?: string | null; color?: string | null },
): Promise<TodoistProject> {
  const body = typeof input === "string"
    ? { name: input }
    : {
        name: input.name,
        ...(input.parentId ? { parent_id: input.parentId } : {}),
        ...(input.color ? { color: input.color } : {}),
      };
  return call<TodoistProject>(token, "/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// =============================================================================
// Labels — Todoist personal labels (free tier) / shared labels (paid).
// Sync API i v1 REST endpointy /labels.
// =============================================================================

export interface TodoistLabel {
  id: string;
  name: string;
  color?: string;
  order?: number;
  is_favorite?: boolean;
}

export async function listLabels(token: string): Promise<TodoistLabel[]> {
  const all: TodoistLabel[] = [];
  let cursor: string | null = null;
  type Page = { results: TodoistLabel[]; next_cursor: string | null };
  for (let i = 0; i < 10; i++) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page: Page = await call<Page>(token, `/labels${query}`);
    if (Array.isArray(page)) return page as unknown as TodoistLabel[];
    if (!page?.results) break;
    all.push(...page.results);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}

export async function createLabel(
  token: string,
  input: { name: string; color?: string | null },
): Promise<TodoistLabel> {
  return call<TodoistLabel>(token, "/labels", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      ...(input.color ? { color: input.color } : {}),
    }),
  });
}

export async function listSections(token: string, projectId: string): Promise<TodoistSection[]> {
  type Page = { results: TodoistSection[]; next_cursor: string | null };
  const all: TodoistSection[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const query: string = cursor
      ? `?project_id=${encodeURIComponent(projectId)}&cursor=${encodeURIComponent(cursor)}`
      : `?project_id=${encodeURIComponent(projectId)}`;
    const page: Page = await call<Page>(token, `/sections${query}`);
    if (Array.isArray(page)) return page as unknown as TodoistSection[];
    if (!page?.results) break;
    all.push(...page.results);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}

export async function createSection(token: string, name: string, projectId: string): Promise<TodoistSection> {
  return call<TodoistSection>(token, "/sections", {
    method: "POST",
    body: JSON.stringify({ name, project_id: projectId }),
  });
}

// =============================================================================
// Sync API — incremental fetch tasků (items) napříč všemi projekty.
// Endpoint: POST /api/v1/sync (Unified API stále podporuje sync formát).
// První volání s sync_token="*" → full snapshot. Další s posledním tokenem
// → jen co se změnilo (added / updated / completed / deleted).
// =============================================================================

export interface TodoistSyncItem {
  id: string;
  user_id?: string;
  project_id: string;
  section_id?: string | null;
  parent_id?: string | null;
  content: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  labels?: string[];
  due?: {
    date?: string;       // YYYY-MM-DD nebo YYYY-MM-DDTHH:MM:SS
    is_recurring?: boolean;
    string?: string;
    timezone?: string | null;
  } | null;
  added_at?: string;
  completed_at?: string | null;
  checked?: boolean;
  is_deleted?: boolean;
}

export interface TodoistSyncResponse {
  sync_token: string;
  full_sync: boolean;
  items?: TodoistSyncItem[];
  projects?: TodoistProject[];
  labels?: TodoistLabel[];
}

export async function syncFetch(
  token: string,
  syncToken: string,
  resourceTypes: string[] = ["items", "projects"],
): Promise<TodoistSyncResponse> {
  return call<TodoistSyncResponse>(token, "/sync", {
    method: "POST",
    body: JSON.stringify({
      sync_token: syncToken,
      resource_types: resourceTypes,
    }),
  });
}

export async function testConnection(token: string): Promise<{ ok: true; projectCount: number } | { ok: false; error: string }> {
  try {
    const projects = await listProjects(token);
    return { ok: true, projectCount: projects.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
