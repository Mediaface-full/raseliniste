import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { syncTodoistForUser } from "@/lib/todoist-sync";

export const prerender = false;

/**
 * GET /api/integrations/todoist/workspace-counts
 *
 * Petr 2026-05-18: rychlá DB check zda Cesta B sync persist proběhl.
 * Bez nutnosti čekat na audit-projects endpoint deploy.
 *
 * Vrací počty per workspace + seznam Team projektů s jejich workspaceId.
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // ?action=sync → spustí sync synchronně před count, bez čekání na cron tick
  let syncResult: any = null;
  if (url.searchParams.get("action") === "sync") {
    try {
      console.log("[workspace-counts] manual sync triggered by", session.uid);
      const stats = await syncTodoistForUser(session.uid);
      syncResult = { ok: true, stats };
    } catch (e) {
      syncResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

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
    syncResult,
    verdict: team > 0
      ? "Sync persist proběhl — Team projekty mají workspaceId"
      : "Žádný Team projekt v mirroru s isTeamProject=true",
    usage: "Přidej ?action=sync abys spustil sync synchronně před count.",
  });
};
