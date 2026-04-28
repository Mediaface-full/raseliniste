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
  priority?: 1 | 2 | 3 | 4;
  due_string?: string; // "today", "tomorrow at 9am", ...
  labels?: string[];
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

export async function testConnection(token: string): Promise<{ ok: true; projectCount: number } | { ok: false; error: string }> {
  try {
    const projects = await listProjects(token);
    return { ok: true, projectCount: projects.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
