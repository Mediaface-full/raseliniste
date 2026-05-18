import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const prerender = false;

/**
 * GET /api/integrations/todoist/workspace-counts
 *
 * Petr 2026-05-18: rychlá DB check zda Cesta B sync persist proběhl.
 * Bez nutnosti čekat na audit-projects endpoint deploy.
 *
 * Vrací počty per workspace + seznam Team projektů s jejich workspaceId.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const total = await prisma.todoistProjectMirror.count({ where: { userId: session.uid } });
  const team = await prisma.todoistProjectMirror.count({
    where: { userId: session.uid, isTeamProject: true },
  });
  const personal = total - team;

  const teamProjects = await prisma.todoistProjectMirror.findMany({
    where: { userId: session.uid, isTeamProject: true },
    select: { name: true, todoistId: true, workspaceId: true, accessVisibility: true },
    orderBy: { name: "asc" },
  });

  const envTeamId = process.env.TODOIST_TEAM_WORKSPACE_ID ?? null;

  return Response.json({
    counts: { total, team, personal },
    teamProjects,
    env: { TODOIST_TEAM_WORKSPACE_ID: envTeamId },
    verdict: team > 0
      ? "✓ Sync persist proběhl — Team projekty mají workspaceId"
      : "✗ Žádný Team projekt v mirroru s isTeamProject=true — sync ještě neproběhl nebo bug v persist",
  });
};
