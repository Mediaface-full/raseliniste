import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import {
  createTask as todoistCreateTask,
  listProjects as todoistListProjects,
  createProject as todoistCreateProject,
  listSections as todoistListSections,
  createSection as todoistCreateSection,
} from "./todoist";

/**
 * Push standalone Task (modul Úkoly /ukoly) do Todoistu.
 * Idempotent přes Task.todoistTaskId.
 *
 * Routing podle delegace (assignedToContact):
 *
 * 1. Top-level projekt s přesně jménem assignee → push tam (sdílený s daným člověkem)
 * 2. Projekt "Lidé" / "People" → najdi/vytvoř sekci jménem assignee → push tam
 * 3. Pokud "Lidé" projekt neexistuje, **vytvoř ho** + sekci s assignee → push tam
 * 4. Bez assignee → push do default mojeUkoly projektu
 *
 * Tím Petr automaticky organizuje delegované úkoly do Lidé/<jméno>, a pokud
 * ten projekt sdílí s lidmi (Dominik, Agáta, ...), oni sekci uvidí nativně.
 */

const PEOPLE_PROJECT_NAME = "Lidé"; // standardní název; lze v budoucnu konfigurovat

const PRIORITY_MAP = { high: 4, normal: 2, low: 1 } as const;

// Cache projektů + sekcí per process — Todoist API není free, 60 s TTL stačí.
interface CacheEntry {
  at: number;
  projects: { id: string; name: string }[];
  // sectionsByProjectId: lazy-loaded podle potřeby
  sectionsByProjectId: Map<string, { id: string; name: string }[]>;
}
const cacheByToken = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

async function getCache(token: string): Promise<CacheEntry> {
  const c = cacheByToken.get(token);
  if (c && Date.now() - c.at < CACHE_TTL_MS) return c;
  const projects = await todoistListProjects(token);
  const fresh: CacheEntry = {
    at: Date.now(),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    sectionsByProjectId: new Map(),
  };
  cacheByToken.set(token, fresh);
  return fresh;
}

function invalidateCache(token: string) {
  cacheByToken.delete(token);
}

/**
 * Resolve cílový projekt + sekci pro daný kontakt (firstName preferred).
 * Vytvoří Lidé projekt nebo sekci pokud chybí.
 */
async function resolveAssigneeRoute(
  token: string,
  displayName: string,
  firstName: string | null,
): Promise<{ projectId: string; sectionId?: string; routedHow: string }> {
  const candidates = [firstName, displayName].filter(Boolean) as string[];
  const cache = await getCache(token);

  // 1) Top-level projekt s přesně jménem
  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    const exact = cache.projects.find((p) => p.name.toLowerCase() === lower);
    if (exact) {
      return { projectId: exact.id, routedHow: `top-level project "${exact.name}"` };
    }
  }

  // 2) Projekt "Lidé" → sekce
  let peopleProj = cache.projects.find(
    (p) => p.name.toLowerCase() === PEOPLE_PROJECT_NAME.toLowerCase() ||
           p.name.toLowerCase() === "people" ||
           p.name.toLowerCase() === "team" ||
           p.name.toLowerCase() === "tým",
  );

  // 3) Pokud Lidé neexistuje → vytvoř
  if (!peopleProj) {
    const created = await todoistCreateProject(token, PEOPLE_PROJECT_NAME);
    peopleProj = { id: created.id, name: created.name };
    invalidateCache(token);
  }

  // Načti sekce v Lidé (cache hit pokud už načteno)
  let sections = cache.sectionsByProjectId.get(peopleProj.id);
  if (!sections) {
    const fetched = await todoistListSections(token, peopleProj.id);
    sections = fetched.map((s) => ({ id: s.id, name: s.name }));
    cache.sectionsByProjectId.set(peopleProj.id, sections);
  }

  // Najdi sekci podle jména
  let section: { id: string; name: string } | undefined;
  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    section = sections.find((s) => s.name.toLowerCase() === lower);
    if (section) break;
  }

  // Vytvoř sekci pokud neexistuje
  if (!section) {
    const sectionName = firstName ?? displayName;
    const createdSection = await todoistCreateSection(token, sectionName, peopleProj.id);
    section = { id: createdSection.id, name: createdSection.name };
    sections.push(section);
  }

  return {
    projectId: peopleProj.id,
    sectionId: section.id,
    routedHow: `project "${peopleProj.name}" → section "${section.name}"`,
  };
}

export async function pushTaskToTodoist(taskId: string): Promise<{ taskId: string; projectId: string; routedHow: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignedToContact: { select: { displayName: true, firstName: true } },
    },
  });
  if (!task) throw new Error("Úkol nenalezen.");
  if (task.todoistTaskId) {
    return {
      taskId: task.todoistTaskId,
      projectId: task.todoistProjectId ?? "",
      routedHow: "already pushed",
    };
  }

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: task.userId, provider: "todoist" } },
  });
  if (!integration) {
    throw new Error("Todoist integrace není nakonfigurovaná. Nastavení → Todoist.");
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
  const cfg = ((integration.config as unknown) ?? {}) as { mojeUkoly?: string };

  // Routing
  let projectId: string | undefined = cfg.mojeUkoly || undefined;
  let sectionId: string | undefined;
  let routedHow = "default mojeUkoly";

  if (task.assignedToContact) {
    try {
      const r = await resolveAssigneeRoute(
        token,
        task.assignedToContact.displayName,
        task.assignedToContact.firstName,
      );
      projectId = r.projectId;
      sectionId = r.sectionId;
      routedHow = r.routedHow;
    } catch (e) {
      // Fallback na default při chybě (např. Todoist 5xx)
      console.warn(`[task-todoist-push] resolveAssigneeRoute failed:`, e);
      routedHow = `fallback default (resolve failed: ${e instanceof Error ? e.message : String(e)})`;
    }
  }

  // Sestav description
  const descLines: string[] = [];
  if (task.notes) descLines.push(task.notes);
  if (task.rawSnippet) descLines.push(`\n_„${task.rawSnippet}"_`);
  descLines.push(`\n_Z Rašeliniště — ${new Date(task.createdAt).toLocaleString("cs-CZ")} · ${routedHow}_`);

  // Due
  let due_string: string | undefined;
  if (task.dueAt) {
    if (task.dueIsTime) {
      // Todoist umí ISO string v due_string fieldu
      due_string = task.dueAt.toISOString();
    } else {
      due_string = task.dueAt.toISOString().slice(0, 10);
    }
  }

  // Labels — lowercase ASCII slug
  const labels = ["raseliniste", ...task.tags].map((t) =>
    t.toLowerCase().replace(/\s+/g, "-").slice(0, 30),
  );

  try {
    const created = await todoistCreateTask(token, {
      content: task.title.slice(0, 500),
      description: descLines.join("\n").slice(0, 16000) || undefined,
      project_id: projectId,
      section_id: sectionId,
      priority: PRIORITY_MAP[task.priority],
      due_string,
      labels,
    });

    await prisma.task.update({
      where: { id: task.id },
      data: {
        todoistTaskId: created.id,
        todoistProjectId: created.project_id,
        pushedAt: new Date(),
        pushError: null,
      },
    });

    await prisma.userIntegration.update({
      where: { id: integration.id },
      data: { lastUsedAt: new Date(), lastError: null },
    });

    return { taskId: created.id, projectId: created.project_id, routedHow };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: task.id },
      data: { pushError: msg.slice(0, 500) },
    });
    throw e;
  }
}
