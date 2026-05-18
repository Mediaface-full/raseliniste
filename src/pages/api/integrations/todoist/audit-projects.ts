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
    // Tabulka VŠECH projektů s diskriminačními fieldy — kde uvidíme rozdíl
    // Personal vs Team. Po Mefa workspace existence chceme zjistit který
    // z 23 projektů jsou v Mefa Team Workspace.
    const allProjects = (sync.projects ?? []).map((p: any) => ({
      name: p.name,
      id: p.id,
      access_visibility: p.access?.visibility ?? null,
      is_shared: p.is_shared ?? null,
      role: p.role ?? null,
      can_assign_tasks: p.can_assign_tasks ?? null,
      parent_id: p.parent_id ?? null,
      // Hledáme cokoliv co odkazuje workspace
      workspace_id: p.workspace_id ?? null,
      v2_workspace_id: p.v2_workspace_id ?? null,
      collaborators_count: Array.isArray(p.collaborator_uids) ? p.collaborator_uids.length : null,
    }));

    syncSample = {
      responseKeys: Object.keys(sync).sort(),
      projects: {
        count: (sync.projects ?? []).length,
        allWithDiscriminators: allProjects,
      },
      workspaces: sync.workspaces ?? null,
      collaborators: sync.collaborators ?? null,
      userTeamRelevant: sync.user ? {
        business_account_id: sync.user.business_account_id ?? null,
        team_inbox_id: sync.user.team_inbox_id ?? null,
      } : null,
      error: null,
    };
  } catch (e) {
    syncSample.error = e instanceof Error ? e.message : String(e);
  }

  // REST endpoint experiments — zda existuje workspace-specific projects fetch
  const restExperiments: Record<string, any> = {};
  for (const path of [
    "/api/v1/projects?workspace_id=645948",
    "/api/v1/workspaces/645948/projects",
    "/api/v1/workspaces/645948",
    "/api/v1/projects/workspace/645948",
  ]) {
    try {
      const r = await fetch(`https://api.todoist.com${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await r.text();
      restExperiments[path] = {
        status: r.status,
        body: text.slice(0, 800),
      };
    } catch (e) {
      restExperiments[path] = { error: e instanceof Error ? e.message : String(e) };
    }
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
    restExperiments,
  });
};
