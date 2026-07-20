/**
 * Todoist activity log pro dashboard (Petr 2026-07-16).
 *
 * Unified API v1 dokumentace uvádí GET /api/v1/activity ("Get Activity Logs"),
 * ale přesný tvar není v docs úplný — proto PROBE: zkusíme /activity,
 * /activities i /activity/get a funkční cestu si zapamatujeme (module-level).
 * Ověření na prod: /api/diagnose/todoist-activity.
 *
 * Komentáře = activity eventy s object_type "note" / "project_note"
 * (text v extra_data.content).
 */

import { prisma } from "./db";
import { decryptSecret } from "./crypto";

const BASE = "https://api.todoist.com/api/v1";
const CANDIDATE_PATHS = ["/activity", "/activities", "/activity/get"];
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface TodoistActivityEvent {
  id: string;
  objectType: string;   // item | note | project | project_note | section…
  eventType: string;    // added | updated | completed | uncompleted | deleted…
  eventDate: Date;
  /** Text úkolu / komentáře (extra_data.content, fallback last_content) */
  content: string;
  initiatorId: string | null;
  parentProjectId: string | null;
  parentItemId: string | null;
}

let workingPath: string | null = null;

async function rawFetch(token: string, params: string): Promise<{ events: unknown[] }> {
  const paths = workingPath ? [workingPath] : CANDIDATE_PATHS;
  let lastErr: Error | null = null;
  for (const p of paths) {
    const res = await fetch(`${BASE}${p}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404 || res.status === 410) {
      lastErr = new Error(`${p} → ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Todoist activity ${p} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as Record<string, unknown>;
    workingPath = p;
    // v1 wrapper {results, next_cursor}, Sync-style {events}, případně holé pole
    const events = (json.results ?? json.events ?? json) as unknown[];
    return { events: Array.isArray(events) ? events : [] };
  }
  throw lastErr ?? new Error("Todoist activity: no endpoint responded");
}

function normalize(raw: unknown): TodoistActivityEvent | null {
  const e = raw as Record<string, any>;
  if (!e || !e.event_date) return null;
  const extra = (e.extra_data ?? {}) as Record<string, any>;
  return {
    id: String(e.id ?? `${e.object_type}-${e.object_id}-${e.event_date}`),
    objectType: String(e.object_type ?? "?"),
    eventType: String(e.event_type ?? "?"),
    eventDate: new Date(e.event_date),
    content: String(extra.content ?? extra.last_content ?? e.content ?? "").trim(),
    initiatorId: e.initiator_id != null ? String(e.initiator_id) : null,
    parentProjectId:
      e.parent_project_id != null ? String(e.parent_project_id)
      : e.v2_parent_project_id != null ? String(e.v2_parent_project_id) : null,
    parentItemId: e.parent_item_id != null ? String(e.parent_item_id) : null,
  };
}

const cacheMap = new Map<string, { fetchedAt: number; data: TodoistActivityEvent[] }>();

/** Activity log seřazený od nejnovějšího. sinceDays omezuje stáří. */
export async function fetchTodoistActivity(
  token: string,
  opts: { limit: number; sinceDays?: number; objectType?: string },
): Promise<TodoistActivityEvent[]> {
  const key = `${opts.limit}|${opts.sinceDays ?? 0}|${opts.objectType ?? ""}`;
  const hit = cacheMap.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  const params = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.objectType) params.set("object_type", opts.objectType);
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
    // Sync API bere "since" jako ISO datetime; v1 wrapper ho ignorovat nevadí
    params.set("since", since.toISOString());
  }
  const { events } = await rawFetch(token, params.toString());
  const data = events
    .map(normalize)
    .filter((x): x is TodoistActivityEvent => x !== null)
    .sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());
  if (cacheMap.size > 20) cacheMap.clear();
  cacheMap.set(key, { fetchedAt: Date.now(), data });
  return data;
}

/**
 * Týdenní feed: obecná aktivita + explicitně komentáře (object_type=note) —
 * activity log komentáře v defaultním listingu někdy nevrací / utopí je
 * mezi item eventy. Merge s dedup podle id.
 */
export async function fetchTodoistWeekFeed(token: string): Promise<TodoistActivityEvent[]> {
  const [general, notes] = await Promise.all([
    fetchTodoistActivity(token, { limit: 100, sinceDays: 7 }),
    fetchTodoistActivity(token, { limit: 50, sinceDays: 7, objectType: "note" }).catch(() => [] as TodoistActivityEvent[]),
  ]);
  const seen = new Set<string>();
  return [...general, ...notes]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());
}

let cachedOwnId: { token: string; id: string | null } | null = null;

/**
 * Vlastní Todoist user ID (pro odfiltrování Gideonových akcí z týmového
 * feedu). GET /user; při selhání null → filtr pak bere jen eventy
 * s initiator_id != null (shared projekty).
 */
export async function fetchOwnTodoistUserId(token: string): Promise<string | null> {
  if (cachedOwnId && cachedOwnId.token === token) return cachedOwnId.id;
  let id: string | null = null;
  try {
    const res = await fetch(`${BASE}/user`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      if (json.id != null) id = String(json.id);
    }
  } catch { /* null fallback */ }
  cachedOwnId = { token, id };
  return id;
}

/**
 * Aktivita ostatních (kolegové v Team Workspace, hosté) — bez Gideonových
 * vlastních akcí. Eventy bez initiator_id jsou z osobních projektů (= vlastní),
 * ty jdou pryč vždy.
 */
export function filterTeamEvents(
  events: TodoistActivityEvent[],
  ownId: string | null,
): TodoistActivityEvent[] {
  return events.filter((e) => e.initiatorId !== null && (ownId === null || e.initiatorId !== ownId));
}

/** Dešifrovaný Todoist token uživatele, null když integrace není. */
export async function getTodoistToken(userId: string): Promise<string | null> {
  const integ = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integ) return null;
  try {
    return decryptSecret({ enc: integ.tokenEnc, iv: integ.tokenIv, tag: integ.tokenTag });
  } catch {
    return null;
  }
}

/** Mapa Todoist user ID → jméno kontaktu (pro initiator jména). */
export async function todoistUserNames(): Promise<Map<string, string>> {
  const contacts = await prisma.contact.findMany({
    where: { todoistUserId: { not: null } },
    select: { todoistUserId: true, displayName: true },
  });
  const map = new Map<string, string>();
  for (const c of contacts) if (c.todoistUserId) map.set(c.todoistUserId, c.displayName);
  return map;
}
