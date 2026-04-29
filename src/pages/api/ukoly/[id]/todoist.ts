import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { pushTaskToTodoist } from "@/lib/task-todoist-push";

export const prerender = false;

/**
 * POST /api/ukoly/:id/todoist — manuální push do Todoistu
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const owned = await prisma.task.findFirst({ where: { id, userId: session.uid } });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const result = await pushTaskToTodoist(id);
    return Response.json({ ok: true, todoistTaskId: result.taskId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
