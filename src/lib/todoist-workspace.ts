import { prisma } from "@/lib/db";

/**
 * Todoist Team Workspace pomocné funkce (Petr 2026-05-18 — Cesta B).
 *
 * Separované do vlastního souboru ať jdou snadno unit-testovat. Zítra
 * refaktorovat snadno (per Petrovy explicitní pojistce).
 */

const KLIENT_PREFIX = "klient-";

/**
 * Personal tagy — pokud úkol obsahuje některý z těchto, půjde do Personal
 * (ne do Team Workspace). Aktualizovat pokud Petr přidá nový.
 */
const PERSONAL_ROUTING_TAGS = new Set(["vip", "rodina", "domov", "lide", "matej"]);

/**
 * Tagy které indikují interní firemní úkol → Team Workspace (i bez klient-*).
 */
const TEAM_ROUTING_TAGS = new Set(["prace"]);

/**
 * Rozhoduje zda úkol patří do Team Workspace nebo Personal.
 *
 * Tabulka pravidel (priority shora dolů):
 *
 *   | Tag pattern                          | preferTeam | Důvod                                  |
 *   |--------------------------------------|------------|----------------------------------------|
 *   | klient-*                             | true       | Klientský úkol → Team Mefa             |
 *   | mix klient-* + personal-*            | true       | Klient má prioritu (specifikum > obecné) |
 *   | vip / rodina / domov / lide / matej  | false      | Personal scope                         |
 *   | prace bez klient-*                   | true       | Interní firemní úkol → Team Práce      |
 *   | žádný routing tag                    | false      | Bezpečný default — Personal (Petr je sole user) |
 *   | prázdné pole                         | false      | Default Personal                       |
 *
 * Pure function — žádné side effects, plně unit-testovatelná.
 */
export function decidePreferTeam(tags: string[]): boolean {
  const lower = tags.map((t) => t.toLowerCase().trim()).filter(Boolean);

  // Pravidlo #1: klient-* tag (s nebo bez personal-* mixu) → vždy Team
  const hasClientTag = lower.some((t) => t.startsWith(KLIENT_PREFIX) && t.length > KLIENT_PREFIX.length);
  if (hasClientTag) return true;

  // Pravidlo #2: čistě personal tag (vip/rodina/...) → Personal
  if (lower.some((t) => PERSONAL_ROUTING_TAGS.has(t))) return false;

  // Pravidlo #3: prace tag (interní firemní úkol bez klienta) → Team
  if (lower.some((t) => TEAM_ROUTING_TAGS.has(t))) return true;

  // Default: Personal (bezpečnější — Petr je sole user, Team má jen
  // explicitně označené úkoly)
  return false;
}

/**
 * Slugifikuje Todoist project name pro match s klient-* tag suffixem.
 *
 *   "TK-STAVBY"       → "tk-stavby"
 *   "AVe Comp"        → "ave-comp"
 *   "Kosmetika Capri" → "kosmetika-capri"
 *   "Pešata"          → "pesata"     (diakritika)
 *   "Bohemian Moldavite" → "bohemian-moldavite"
 *
 * Pure function.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Vrátí Team Workspace ID z env (`TODOIST_TEAM_WORKSPACE_ID=645948`).
 *
 * Pravidla:
 * - Pokud env není nastavena → null (Personal-only mode, decidePreferTeam
 *   stejně rozhoduje, ale resolveClientProject vrátí null = fallback Personal)
 * - Pokud env je nenumerický string → console.warn + null
 * - Hardcoded fallback ZAKÁZÁN (Petrova pojistka)
 */
export function getTeamWorkspaceId(): string | null {
  const raw = process.env.TODOIST_TEAM_WORKSPACE_ID;
  if (!raw || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) {
    console.warn(`[todoist-workspace] TODOIST_TEAM_WORKSPACE_ID="${raw}" není numerický — Personal-only mode.`);
    return null;
  }
  return raw.trim();
}

/**
 * Najde Team Workspace projekt v TodoistProjectMirror podle klient-* tagu.
 *
 * Postup:
 *   1. Extrahuj suffix z prvního klient-* tagu ("klient-tk-stavby" → "tk-stavby")
 *   2. Pokud env TODOIST_TEAM_WORKSPACE_ID není set → null (fallback)
 *   3. Najdi v mirroru projekt kde:
 *      - isTeamProject = true
 *      - workspaceId = teamId
 *      - slugify(name) === suffix
 *   4. Vrátí { todoistId, name } nebo null pokud neexistuje
 *
 * `null` znamená fallback → routing pravidlo #1 použije původní pattern
 * (Personal "Práce" + sekce humanizeSlug(suffix)).
 */
export interface ResolvedClientProject {
  todoistId: string;
  name: string;
  workspaceId: string;
}

export async function resolveClientProject(
  userId: string,
  tags: string[],
): Promise<ResolvedClientProject | null> {
  const lower = tags.map((t) => t.toLowerCase().trim());
  const clientTag = lower.find((t) => t.startsWith(KLIENT_PREFIX) && t.length > KLIENT_PREFIX.length);
  if (!clientTag) return null;

  const teamId = getTeamWorkspaceId();
  if (!teamId) return null; // Personal-only mode

  const slug = clientTag.slice(KLIENT_PREFIX.length);
  if (!slug) return null; // malformed "klient-" bez suffixu

  // Načti všechny Team projekty pro tohoto usera + workspace
  const candidates = await prisma.todoistProjectMirror.findMany({
    where: { userId, workspaceId: teamId, isTeamProject: true },
    select: { todoistId: true, name: true, workspaceId: true },
  });

  // Match slugify(name) === suffix
  const match = candidates.find((c) => slugify(c.name) === slug);
  if (!match) return null;

  return {
    todoistId: match.todoistId,
    name: match.name,
    workspaceId: match.workspaceId!,
  };
}
