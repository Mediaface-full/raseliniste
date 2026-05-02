import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dueIsTime: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToContactId: z.string().nullable().optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
});

async function ownTask(userId: string, id: string) {
  return prisma.task.findFirst({ where: { id, userId } });
}

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;

  // VIP mise — id má prefix "callLog:<uuid>". Propíšeme jen status (seenAt).
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
    } else if (d.status === "open") {
      await prisma.callLog.update({ where: { id: callLogId }, data: { seenAt: null } });
    }
    // Ostatní pole (title, tags, …) u VIP misí ignorujeme — content je editovatelný
    // jen ve firewall logu (admin) a originál CallLog nemá ekvivalentní fieldy.
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
  if (d.status === "done" && owned.status !== "done") data.completedAt = new Date();
  if (d.status === "open" && owned.status === "done") data.completedAt = null;

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

  // VIP mise nelze přes /ukoly mazat — to se dělá v /firewall.
  if (id.startsWith("callLog:")) {
    return Response.json({ error: "VIP mise smaž v /firewall" }, { status: 400 });
  }

  const owned = await ownTask(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.task.delete({ where: { id } });
  return Response.json({ ok: true });
};
