import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import {
  createTask as todoistCreateTask,
  listProjects as todoistListProjects,
  createProject as todoistCreateProject,
  listSections as todoistListSections,
  createSection as todoistCreateSection,
  taskPriorityToTodoist,
} from "./todoist";
import { resolveClientProject } from "./todoist-workspace";

/**
 * Push standalone Task (modul Úkoly /ukoly) do Todoistu.
 * Idempotent přes Task.todoistTaskId.
 *
 * Smart routing — pořadí pravidel (top-down, první match vyhrává):
 *
 *   #0 VIP firewall submit (řeší samostatný path call-log/submit, ne tady)
 *   #1 Tag `klient-<slug>` → projekt "Práce" / sekce <slug>
 *   #2 assignedToContact.clientTag → projekt "Práce" / sekce <clientTag>
 *   #3 assignedToContact.isTeam → projekt "Práce" / sekce <jméno>
 *   #4 assignedToContact (obecný kontakt) → projekt "Lidé" / sekce <jméno>
 *   #5 Tag z `tagToProject` mapy (např. dum → Osobní/Domov) → projekt/sekce
 *   #6 Fallback → mojeUkoly nebo Inbox
 *
 * t-* tagy (trvání: t-30m, t-1h, ...) se z routing logiky filtrují —
 * jsou jen metadata, neovlivňují cíl.
 *
 * Auto-create projektu i sekce: pokud cíl neexistuje, Rašeliniště ho v
 * Todoistu vytvoří. Každý auto-create se loguje do RoutingAuditLog —
 * Petr to vidí v /settings/crons (sekce "Routing audit log").
 */

// Konfigurovatelné default project názvy — pokud uživatel v config nemá custom.
const DEFAULT_PEOPLE_PROJECT = "Lidé";
const DEFAULT_PRACE_PROJECT = "Práce";

// t-* tagy (trvání úkolu) — filtrujeme z routing logiky.
const T_TAG_PREFIX = "t-";

// klient-* tagy — pravidlo #1.
const KLIENT_TAG_PREFIX = "klient-";

// Priority mapping je centralizován v src/lib/todoist.ts (taskPriorityToTodoist).
const PRIORITY_MAP = {
  high: taskPriorityToTodoist("high"),
  normal: taskPriorityToTodoist("normal"),
  low: taskPriorityToTodoist("low"),
} as const;

// Cache projektů + sekcí per process — Todoist API není free, 60 s TTL stačí.
interface CacheEntry {
  at: number;
  projects: { id: string; name: string }[];
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

/** Najde projekt podle jména (case-insensitive). */
function findProject(cache: CacheEntry, name: string): { id: string; name: string } | undefined {
  const lower = name.toLowerCase();
  return cache.projects.find((p) => p.name.toLowerCase() === lower);
}

/** Najde nebo vytvoří projekt + zaloguje auto-create info do `audit`.
 *
 * Petr 2026-05-18 (Hot fix A pro Team Workspace migraci):
 * Env `TODOIST_AUTO_CREATE=false` zakáže auto-create. Důvod: před přesunem
 * Práce do Team Workspace nechceme aby kód vyrobil nové Personal projekty
 * stejného jména (regresí). Po implementaci Cesty B (workspace-aware routing)
 * bude flag opět default true.
 */
async function ensureProject(
  token: string,
  name: string,
  audit: { autoCreatedProject: boolean },
): Promise<{ id: string; name: string }> {
  const cache = await getCache(token);
  const existing = findProject(cache, name);
  if (existing) return existing;
  if (process.env.TODOIST_AUTO_CREATE === "false") {
    throw new Error(
      `Todoist projekt "${name}" neexistuje a TODOIST_AUTO_CREATE=false (Hot fix A před Team Workspace migrací). ` +
      `Buď vytvoř projekt ručně v Todoistu, nebo nastav TODOIST_AUTO_CREATE=true v .env.`,
    );
  }
  const created = await todoistCreateProject(token, name);
  audit.autoCreatedProject = true;
  invalidateCache(token);
  return { id: created.id, name: created.name };
}

/** Najde nebo vytvoří sekci v projektu + zaloguje auto-create info. */
async function ensureSection(
  token: string,
  projectId: string,
  sectionName: string,
  audit: { autoCreatedSection: boolean },
): Promise<{ id: string; name: string }> {
  const cache = await getCache(token);
  let sections = cache.sectionsByProjectId.get(projectId);
  if (!sections) {
    const fetched = await todoistListSections(token, projectId);
    sections = fetched.map((s) => ({ id: s.id, name: s.name }));
    cache.sectionsByProjectId.set(projectId, sections);
  }
  const lower = sectionName.toLowerCase();
  const existing = sections.find((s) => s.name.toLowerCase() === lower);
  if (existing) return existing;
  const created = await todoistCreateSection(token, sectionName, projectId);
  const fresh = { id: created.id, name: created.name };
  sections.push(fresh);
  audit.autoCreatedSection = true;
  return fresh;
}

interface RouteResolution {
  projectId: string | undefined;
  sectionId?: string | null;
  routedHow: string;
  rule: string;
  matchedValue: string | null;
  projectName: string | null;
  sectionName: string | null;
  autoCreatedProject: boolean;
  autoCreatedSection: boolean;
}

/**
 * Pravidlo pro routing #5. Multi-tag — pravidlo matchne když task.tags obsahuje
 * KTERÝKOLIV z `tags`. `name` je jen pro orientaci uživatele v UI, nepoužívá
 * se v logice. NOVÝ TVAR 2026-05-10.
 */
export interface TagRule {
  name?: string | null;
  tags: string[];
  project: string;
  section: string | null;
}

/**
 * Backwards-compat helper: starý config `tagToProject` byl `Record<string, {project, section}>`
 * (klíč = single tag). Nový tvar je `TagRule[]` (multi-tag per pravidlo).
 * Při čtení normalizujeme oba formáty na pole pravidel — postupně se přepíše
 * při příštím Save v UI.
 */
export function normalizeTagRules(raw: unknown): TagRule[] {
  if (!raw) return [];
  // Nový tvar: array
  if (Array.isArray(raw)) {
    const rules: TagRule[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const project = typeof r.project === "string" ? r.project.trim() : "";
      if (!project) continue;
      const tags = Array.isArray(r.tags)
        ? (r.tags as unknown[])
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];
      if (tags.length === 0) continue;
      rules.push({
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
        tags: [...new Set(tags)],
        project,
        section:
          typeof r.section === "string" && r.section.trim() ? r.section.trim() : null,
      });
    }
    return rules;
  }
  // Starý tvar: dict { tag: { project, section } } → převést na array
  if (typeof raw === "object") {
    const rules: TagRule[] = [];
    for (const [tag, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const project = typeof v.project === "string" ? v.project.trim() : "";
      if (!project) continue;
      const normTag = tag.trim().toLowerCase();
      if (!normTag) continue;
      rules.push({
        name: null,
        tags: [normTag],
        project,
        section:
          typeof v.section === "string" && v.section.trim() ? v.section.trim() : null,
      });
    }
    return rules;
  }
  return [];
}

interface RouteContext {
  token: string;
  userId: string;                            // pro lookup TodoistProjectMirror (Team Workspace)
  fallbackProjectId: string | undefined;     // mojeUkoly / Inbox
  praceProjectName: string;                  // typicky "Práce"
  peopleProjectName: string;                 // typicky "Lidé"
  tagRules: TagRule[];                       // routing #5 pravidla (multi-tag)
}

/**
 * Resolve cílový projekt + sekci.
 * Vrací RouteResolution s metadaty pro audit log.
 */
async function resolveRoute(
  ctx: RouteContext,
  task: {
    tags: string[];
    assignedToContact: {
      displayName: string;
      firstName: string | null;
      isTeam: boolean;
      clientTag: string | null;
    } | null;
  },
): Promise<RouteResolution> {
  const audit = { autoCreatedProject: false, autoCreatedSection: false };

  // Filtr t-* (jsou meta, ne routing) — pravidlo #1 i #5 hledá v očištěném seznamu
  const routableTags = task.tags.filter((t) => !t.startsWith(T_TAG_PREFIX));

  // ---- #1 Tag klient-<slug> → Team Workspace root projekt (preferred) NEBO
  //         Personal Práce + sekce <slug> (fallback) ----
  // Petr 2026-05-18 (Cesta B): klientské projekty jsou v Team Mefa
  // (workspaceId=645948) jako root projekty. Smart routing nejdřív zkusí
  // najít root projekt v Team mirror (slugify match), pokud nenajde,
  // fallback na původní Personal Práce + sekce.
  const klientTag = routableTags.find((t) => t.startsWith(KLIENT_TAG_PREFIX));
  if (klientTag) {
    const slug = klientTag.slice(KLIENT_TAG_PREFIX.length);
    // Preferential Team Workspace lookup
    const teamProject = await resolveClientProject(ctx.userId, [klientTag]);
    if (teamProject) {
      return {
        projectId: teamProject.todoistId,
        sectionId: null,
        routedHow: `[klient-tag → team] "${teamProject.name}" (workspace ${teamProject.workspaceId})`,
        rule: "klient-tag",
        matchedValue: slug,
        projectName: teamProject.name,
        sectionName: null,
        ...audit,
      };
    }
    // Fallback: Personal Práce + sekce
    const sectionName = humanizeSlug(slug);
    const project = await ensureProject(ctx.token, ctx.praceProjectName, audit);
    const section = await ensureSection(ctx.token, project.id, sectionName, audit);
    return {
      projectId: project.id,
      sectionId: section.id,
      routedHow: `[klient-tag → personal-fallback] "${ctx.praceProjectName}" → "${section.name}"`,
      rule: "klient-tag",
      matchedValue: slug,
      projectName: project.name,
      sectionName: section.name,
      ...audit,
    };
  }

  // ---- #2 assignedToContact.clientTag → Team Workspace root (preferred) NEBO
  //         Personal Práce + sekce (fallback) ----
  if (task.assignedToContact?.clientTag) {
    const slug = task.assignedToContact.clientTag;
    // Preferential Team Workspace lookup (přes pseudo-tag klient-<slug>)
    const teamProject = await resolveClientProject(ctx.userId, [`${KLIENT_TAG_PREFIX}${slug}`]);
    if (teamProject) {
      return {
        projectId: teamProject.todoistId,
        sectionId: null,
        routedHow: `[klient-contact → team] "${teamProject.name}" (workspace ${teamProject.workspaceId})`,
        rule: "klient-contact",
        matchedValue: `${task.assignedToContact.displayName} → ${slug}`,
        projectName: teamProject.name,
        sectionName: null,
        ...audit,
      };
    }
    // Fallback: Personal Práce + sekce
    const sectionName = humanizeSlug(slug);
    const project = await ensureProject(ctx.token, ctx.praceProjectName, audit);
    const section = await ensureSection(ctx.token, project.id, sectionName, audit);
    return {
      projectId: project.id,
      sectionId: section.id,
      routedHow: `[klient-contact → personal-fallback] "${ctx.praceProjectName}" → "${section.name}"`,
      rule: "klient-contact",
      matchedValue: `${task.assignedToContact.displayName} → ${slug}`,
      projectName: project.name,
      sectionName: section.name,
      ...audit,
    };
  }

  // ---- #3 assignedToContact.isTeam → Práce / sekce <jméno> ----
  if (task.assignedToContact?.isTeam) {
    const sectionName = task.assignedToContact.firstName ?? task.assignedToContact.displayName;
    const project = await ensureProject(ctx.token, ctx.praceProjectName, audit);
    const section = await ensureSection(ctx.token, project.id, sectionName, audit);
    return {
      projectId: project.id,
      sectionId: section.id,
      routedHow: `[team] "${ctx.praceProjectName}" → "${section.name}"`,
      rule: "team",
      matchedValue: sectionName,
      projectName: project.name,
      sectionName: section.name,
      ...audit,
    };
  }

  // ---- #4 assignedToContact (obecný kontakt) → Lidé / sekce <jméno> ----
  if (task.assignedToContact) {
    // Edge case: top-level projekt s přesně jménem kontaktu (sdílený projekt)
    // — preferovat před sekcí v Lidé. Zachováno z předchozí logiky.
    const cache = await getCache(ctx.token);
    const candidates = [task.assignedToContact.firstName, task.assignedToContact.displayName].filter(Boolean) as string[];
    for (const cand of candidates) {
      const exact = findProject(cache, cand);
      if (exact) {
        return {
          projectId: exact.id,
          routedHow: `[shared-project] "${exact.name}"`,
          rule: "people",
          matchedValue: cand,
          projectName: exact.name,
          sectionName: null,
          ...audit,
        };
      }
    }

    const sectionName = task.assignedToContact.firstName ?? task.assignedToContact.displayName;
    const project = await ensureProject(ctx.token, ctx.peopleProjectName, audit);
    const section = await ensureSection(ctx.token, project.id, sectionName, audit);
    return {
      projectId: project.id,
      sectionId: section.id,
      routedHow: `[people] "${ctx.peopleProjectName}" → "${section.name}"`,
      rule: "people",
      matchedValue: sectionName,
      projectName: project.name,
      sectionName: section.name,
      ...audit,
    };
  }

  // ---- #5 Tag z tagRules → konfigurovatelný projekt/sekce ----
  // Pravidlo matchne když task.tags obsahuje KTERÝKOLIV z rule.tags.
  // Pořadí pravidel v poli = priorita (první match vyhrává).
  const routableTagsLower = routableTags.map((t) => t.toLowerCase());
  for (const rule of ctx.tagRules) {
    const matchedTag = rule.tags.find((t) => routableTagsLower.includes(t));
    if (!matchedTag) continue;
    const project = await ensureProject(ctx.token, rule.project, audit);
    let sectionId: string | undefined;
    let sectionName: string | null = null;
    if (rule.section) {
      const section = await ensureSection(ctx.token, project.id, rule.section, audit);
      sectionId = section.id;
      sectionName = section.name;
    }
    return {
      projectId: project.id,
      sectionId,
      routedHow: `[personal-tag${rule.name ? `:${rule.name}` : ""}] "${project.name}"${sectionName ? ` → "${sectionName}"` : ""}`,
      rule: "personal-tag",
      matchedValue: rule.name ? `${rule.name} (${matchedTag})` : matchedTag,
      projectName: project.name,
      sectionName,
      ...audit,
    };
  }

  // ---- #6 Fallback → mojeUkoly nebo Inbox ----
  return {
    projectId: ctx.fallbackProjectId,
    routedHow: ctx.fallbackProjectId ? "[fallback] mojeUkoly" : "[fallback] Inbox",
    rule: "fallback",
    matchedValue: null,
    projectName: null,
    sectionName: null,
    ...audit,
  };
}

/** Slug → human-readable section name. Např. "tk-stavby" → "TK Stavby". */
function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => {
      // Zachovat zkratky (TK, IT, OSVČ) v capslocku pokud kratší než 4 a vše malé
      if (w.length <= 3 && w === w.toLowerCase()) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

interface IntegrationConfig {
  mojeUkoly?: string;
  praceProjectName?: string;
  peopleProjectName?: string;
  // Nový tvar: TagRule[] (multi-tag per pravidlo).
  // Starý tvar: Record<string, {project, section}> — normalizován přes normalizeTagRules().
  tagToProject?: unknown;
}

export async function pushTaskToTodoist(taskId: string): Promise<{ taskId: string; projectId: string; routedHow: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignedToContact: { select: { displayName: true, firstName: true, isTeam: true, clientTag: true } },
      parent: { select: { id: true, todoistTaskId: true, todoistProjectId: true } },
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

  // Subtask: musí jít do stejného projektu jako rodič (Todoist requirement).
  let todoistParentId: string | undefined;
  let parentRoutedProjectId: string | undefined;
  if (task.parentId) {
    if (task.parent?.todoistTaskId) {
      todoistParentId = task.parent.todoistTaskId;
      parentRoutedProjectId = task.parent.todoistProjectId ?? undefined;
    } else {
      const parentResult = await pushTaskToTodoist(task.parentId);
      todoistParentId = parentResult.taskId;
      parentRoutedProjectId = parentResult.projectId || undefined;
    }
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
  const cfg = ((integration.config as unknown) ?? {}) as IntegrationConfig;

  // Routing — subtask dědí z rodiče, jinak smart routing.
  let projectId: string | undefined;
  let sectionId: string | undefined;
  let routedHow: string;
  let routeMeta: RouteResolution | null = null;

  if (todoistParentId) {
    projectId = parentRoutedProjectId;
    routedHow = "inherited from parent";
  } else {
    const ctx: RouteContext = {
      token,
      userId: task.userId,
      fallbackProjectId: cfg.mojeUkoly,
      praceProjectName: cfg.praceProjectName ?? DEFAULT_PRACE_PROJECT,
      peopleProjectName: cfg.peopleProjectName ?? DEFAULT_PEOPLE_PROJECT,
      tagRules: normalizeTagRules(cfg.tagToProject),
    };
    try {
      routeMeta = await resolveRoute(ctx, {
        tags: task.tags,
        assignedToContact: task.assignedToContact ?? null,
      });
      projectId = routeMeta.projectId;
      sectionId = routeMeta.sectionId;
      routedHow = routeMeta.routedHow;
    } catch (e) {
      console.warn("[task-todoist-push] resolveRoute failed:", e);
      projectId = cfg.mojeUkoly;
      routedHow = `fallback default (resolve failed: ${e instanceof Error ? e.message : String(e)})`;
    }
  }

  // Sestav description
  const descLines: string[] = [];
  if (task.notes) descLines.push(task.notes);
  if (task.rawSnippet) descLines.push(`\n_„${task.rawSnippet}"_`);
  descLines.push(`\n_Z Rašeliniště — ${new Date(task.createdAt).toLocaleString("cs-CZ")} · ${routedHow}_`);

  // Due — Todoist v1 má 3 oddělená pole.
  let due_date: string | undefined;
  let due_datetime: string | undefined;
  if (task.dueAt) {
    if (task.dueIsTime) {
      due_datetime = task.dueAt.toISOString();
    } else {
      due_date = task.dueAt.toISOString().slice(0, 10);
    }
  }

  // Labels — diakritika removed + lowercase + slug. t-* a klient-* už jsou
  // formátované, ale projedou normalizací bezpečně.
  const labels = ["raseliniste", ...task.tags].map((t) =>
    t.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, "-").slice(0, 60),
  );

  try {
    const created = await todoistCreateTask(token, {
      content: task.title.slice(0, 500),
      description: descLines.join("\n").slice(0, 16000) || undefined,
      project_id: projectId,
      section_id: sectionId,
      parent_id: todoistParentId,
      priority: PRIORITY_MAP[task.priority],
      due_date,
      due_datetime,
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

    // Audit log — fire-and-forget (nejde o critical path)
    if (routeMeta) {
      void prisma.routingAuditLog.create({
        data: {
          userId: task.userId,
          taskId: task.id,
          taskTitle: task.title.slice(0, 500),
          rule: routeMeta.rule,
          matchedValue: routeMeta.matchedValue,
          todoistProjectName: routeMeta.projectName,
          todoistSectionName: routeMeta.sectionName,
          todoistProjectId: created.project_id,
          todoistSectionId: created.section_id ?? null,
          autoCreatedProject: routeMeta.autoCreatedProject,
          autoCreatedSection: routeMeta.autoCreatedSection,
        },
      }).catch((err) => console.warn("[task-todoist-push] audit log skip:", err));
    }

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
