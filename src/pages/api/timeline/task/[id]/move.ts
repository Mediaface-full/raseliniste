import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { readSession } from "@/lib/session";
import { updateTask } from "@/lib/todoist";

export const prerender = false;

const Body = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/timeline/task/:id/move
 *
 * F5: drag úkolu na jiný den. Volá Todoist API PATCH due_date, pokud má
 * task `todoistTaskId`. Updatne i lokální Task.dueAt aby UI vidělo změnu
 * okamžitě (sync à 5 min by to taky zachytil, ale rychlejší rovnou).
 *
 * Petr 2026-05-19.
 */
export const POST: APIRoute = async ({ request, params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const task = await prisma.task.findFirst({
    where: { id, userId: session.uid },
    select: { id: true, todoistTaskId: true, dueIsTime: true },
  });
  if (!task) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Update local
  const newDue = new Date(`${parsed.data.startDate}T00:00:00`);
  await prisma.task.update({
    where: { id },
    data: { dueAt: newDue },
  });

  // Push do Todoist (best-effort — když selže, lokální stav je už uložený)
  let todoistError: string | null = null;
  if (task.todoistTaskId) {
    try {
      const integration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId: session.uid, provider: "todoist" } },
      });
      if (integration) {
        const token = decryptSecret({
          enc: integration.tokenEnc,
          iv: integration.tokenIv,
          tag: integration.tokenTag,
        });
        // Pokud byl dueIsTime=true, zachováme čas + nastavíme nové datum.
        // Pro Timeline view = pracujeme s celodenními úkoly, takže due_date.
        await updateTask(token, task.todoistTaskId, {
          due_date: parsed.data.startDate,
        });
      }
    } catch (e) {
      todoistError = e instanceof Error ? e.message : String(e);
      console.warn(`[timeline-move] todoist update failed for task ${id}:`, todoistError);
    }
  }

  return Response.json({
    ok: true,
    localUpdated: true,
    todoistUpdated: !todoistError && !!task.todoistTaskId,
    todoistError,
  });
};
