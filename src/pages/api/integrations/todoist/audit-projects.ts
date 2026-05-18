import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { listProjects, syncFetch } from "@/lib/todoist";

async function getTodoistToken(userId: string): Promise<string | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integration) return null;
  try {
    return decryptSecret({ enc: integration.tokenEnc, iv: integration.tokenIv, tag: integration.tokenTag });
  } catch {
    return null;
  }
}

export const prerender = false;

/**
 * GET /api/integrations/todoist/audit-projects
 *
 * Petr 2026-05-18: Diagnostika před Team Workspace migrací.
 * Vrací:
 *   - mirror: co je v naší DB (TodoistProjectMirror)
 *   - remote: čerstvý fetch z Todoist API (jen Personal v současné v1)
 *   - duplicates: projekty se stejným názvem (case-insensitive)
 *
 * Po implementaci Cesty B přidám i workspace_id pro každý projekt.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const token = await getTodoistToken(session.uid);
  if (!token) return Response.json({ error: "Todoist není připojen." }, { status: 400 });

  // Mirror z DB
  const mirror = await prisma.todoistProjectMirror.findMany({
    where: { userId: session.uid },
    orderBy: { name: "asc" },
    select: { todoistId: true, name: true, parentId: true, isInbox: true, syncedAt: true },
  });

  // Čerstvý fetch z Todoist API (v1 /projects)
  let remote: Awaited<ReturnType<typeof listProjects>> = [];
  let remoteError: string | null = null;
  try {
    remote = await listProjects(token);
  } catch (e) {
    remoteError = e instanceof Error ? e.message : String(e);
  }

  // Najdi duplicity v mirroru (stejný název case-insensitive)
  const byName = new Map<string, typeof mirror>();
  for (const p of mirror) {
    const key = p.name.toLowerCase().trim();
    const list = byName.get(key) ?? [];
    list.push(p);
    byName.set(key, list);
  }
  const duplicates = Array.from(byName.entries())
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, projects: list }));

  // Stejné z remote (jistota že je sync aktuální)
  const remoteByName = new Map<string, typeof remote>();
  for (const p of remote) {
    const key = p.name.toLowerCase().trim();
    const list = remoteByName.get(key) ?? [];
    list.push(p);
    remoteByName.set(key, list);
  }
  const remoteDuplicates = Array.from(remoteByName.entries())
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, projects: list }));

  // Sync API experiment — projects resource nevrací workspace_id (audit
  // 2026-05-18). Zkusíme širší resource_types: zda Todoist API dá workspace
  // info v jiném resource (workspaces, user_workspaces, team_invitations,
  // collaborators).
  let syncSample: any = { error: null };
  try {
    const sync: any = await syncFetch(token, "*", [
      "projects",
      "workspaces",
      "user_workspaces",
      "team_invitations",
      "collaborators",
      "user",
    ]);
    syncSample = {
      // Top-level klíče celé response — zjistíme co Todoist vůbec vrátí
      responseKeys: Object.keys(sync).sort(),
      // Per-resource sample
      projects: {
        count: (sync.projects ?? []).length,
        firstProjectKeys: sync.projects?.[0] ? Object.keys(sync.projects[0]).sort() : [],
        sampleProject: sync.projects?.[0] ?? null,
      },
      workspaces: sync.workspaces ?? null,
      user_workspaces: sync.user_workspaces ?? null,
      team_invitations: sync.team_invitations ?? null,
      collaborators: sync.collaborators ?? null,
      // user objekt může mít business/team flag
      userTeamRelevant: sync.user ? {
        id: sync.user.id,
        full_name: sync.user.full_name,
        team_inbox_id: sync.user.team_inbox_id ?? null,
        business_account_id: sync.user.business_account_id ?? null,
        has_business_account: sync.user.has_business_account ?? null,
        __keys: Object.keys(sync.user).sort(),
      } : null,
      error: null,
    };
  } catch (e) {
    syncSample.error = e instanceof Error ? e.message : String(e);
  }

  return Response.json({
    note: "API v1 /projects vrací JEN Personal workspace. Team Workspace projekty zde nevidíš. Sync API ukázka níže — uvidíme zda workspace_id v project objektu existuje.",
    mirror: {
      count: mirror.length,
      projects: mirror,
    },
    remote: {
      count: remote.length,
      error: remoteError,
      projects: remote.map((p) => ({ id: p.id, name: p.name, parent_id: p.parent_id, is_inbox_project: p.is_inbox_project })),
    },
    duplicates: {
      mirror: duplicates,
      remote: remoteDuplicates,
    },
    syncSample,
  });
};
