import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { closeTask, reopenTask, deleteTask as todoistDeleteTask, updateTask as todoistUpdateTask, taskPriorityToTodoist, type UpdateTaskInput } from "@/lib/todoist";

export const prerender = false;

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dueIsTime: z.boolean().optional(),
  // Plánovaný den výroby (execution date) — YYYY-MM-DD, jen Rašeliniště
  plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToContactId: z.string().nullable().optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
});

async function ownTask(userId: string, id: string) {
  return prisma.task.findFirst({ where: { id, userId } });
}

/**
 * Pokus o get Todoist token; null pokud integrace není.
 */
async function getTodoistToken(userId: string): Promise<string | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "todoist" } },
  });
  if (!integration) return null;
  return decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
}

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;

  // VIP mise — id má prefix "callLog:<uuid>". Propíšeme jen status (seenAt) +
  // close/reopen v Todoistu pokud má todoistTaskId.
  if (id.startsWith("callLog:")) {
    const callLogId = id.slice("callLog:".length);
    const cl = await prisma.callLog.findFirst({ where: { id: callLogId, userId: session.uid } });
    if (!cl) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    const d = parsed.data;

    if (d.status === "done") {
      await prisma.callLog.update({ where: { id: callLogId }, data: { seenAt: new Date() } });
      // Propaguj do Todoistu (close)
      if (cl.todoistTaskId) {
        const token = await getTodoistToken(session.uid);
        if (token) {
          try { await closeTask(token, cl.todoistTaskId); } catch (e) {
            console.warn("[ukoly callLog close]", e instanceof Error ? e.message : String(e));
          }
        }
      }
    } else if (d.status === "open") {
      await prisma.callLog.update({ where: { id: callLogId }, data: { seenAt: null } });
      if (cl.todoistTaskId) {
        const token = await getTodoistToken(session.uid);
        if (token) {
          try { await reopenTask(token, cl.todoistTaskId); } catch (e) {
            console.warn("[ukoly callLog reopen]", e instanceof Error ? e.message : String(e));
          }
        }
      }
    }
    return Response.json({ ok: true, callLogId });
  }

  const owned = await ownTask(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const d = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { ...d };
  if (d.dueAt !== undefined) data.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.plannedFor !== undefined) data.plannedFor = d.plannedFor ? new Date(`${d.plannedFor}T00:00:00`) : null;

  // Status změna → propagace do Todoistu (synchronně) + lokální completedAt
  let todoistAction: "close" | "reopen" | null = null;
  if (d.status === "done" && owned.status !== "done") {
    data.completedAt = new Date();
    todoistAction = "close";
  } else if (d.status === "open" && owned.status === "done") {
    data.completedAt = null;
    todoistAction = "reopen";
  }

  // Detekce content edit (title/notes/dueAt/labels/priority) — propíšeme do Todoistu.
  // Bez toho by pull cron za 5 min přepsal naše změny zpět z Todoistu (zdroj pravdy).
  const contentChanged =
    d.title !== undefined ||
    d.notes !== undefined ||
    d.dueAt !== undefined ||
    d.tags !== undefined ||
    d.priority !== undefined;

  let pushError: string | null = null;

  if ((todoistAction || contentChanged) && owned.todoistTaskId) {
    const token = await getTodoistToken(session.uid);
    if (token) {
      try {
        // 1. Status close/reopen
        if (todoistAction === "close") await closeTask(token, owned.todoistTaskId);
        else if (todoistAction === "reopen") await reopenTask(token, owned.todoistTaskId);

        // 2. Content update — title/notes/due/labels/priority
        if (contentChanged) {
          const update: UpdateTaskInput = {};
          if (d.title !== undefined) update.content = d.title;
          if (d.notes !== undefined) update.description = d.notes ?? "";
          if (d.dueAt !== undefined) {
            if (d.dueAt === null) {
              // Clear due — Todoist konvence: due_string="" (NE due_date="")
              update.due_string = "";
            } else {
              const dt = new Date(d.dueAt);
              if (d.dueIsTime || (owned.dueIsTime && d.dueIsTime !== false)) {
                update.due_datetime = dt.toISOString();
              } else {
                update.due_date = dt.toISOString().slice(0, 10);
              }
            }
          }
          if (d.tags !== undefined) update.labels = d.tags;
          if (d.priority !== undefined) {
            update.priority = taskPriorityToTodoist(d.priority);
          }
          if (Object.keys(update).length > 0) {
            await todoistUpdateTask(token, owned.todoistTaskId, update);
          }
        }
      } catch (e) {
        pushError = e instanceof Error ? e.message : String(e);
        console.warn(`[ukoly patch propagace]`, pushError);
      }
    }
  }

  if (pushError) {
    data.pushError = `Todoist update fail: ${pushError.slice(0, 200)}`;
  } else if (contentChanged || todoistAction) {
    // Vyčistit starý pushError pokud nyní propagace prošla
    data.pushError = null;
  }

  const task = await prisma.task.update({
    where: { id },
    data,
    include: { assignedToContact: { select: { id: true, displayName: true } } },
  });
  return Response.json({ task });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;

  if (id.startsWith("callLog:")) {
    return Response.json({ error: "VIP mise smaž v /firewall" }, { status: 400 });
  }

  const owned = await ownTask(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Propaguj do Todoistu (DELETE) PŘED lokálním smazáním. Pokud Todoist selže,
  // pokračujeme — alternativně bychom mohli abort, ale Petr by byl frustrovaný
  // pokud Todoist down zablokuje lokální mazání. Idempotent (404 ignoruje).
  if (owned.todoistTaskId) {
    const token = await getTodoistToken(session.uid);
    if (token) {
      try {
        await todoistDeleteTask(token, owned.todoistTaskId);
      } catch (e) {
        console.warn("[ukoly delete-todoist]", e instanceof Error ? e.message : String(e));
      }
    }
  }

  await prisma.task.delete({ where: { id } });
  return Response.json({ ok: true });
};
