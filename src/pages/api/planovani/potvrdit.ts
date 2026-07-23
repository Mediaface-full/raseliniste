import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  assignments: z.array(z.object({
    taskId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1).max(100),
});

/** POST /api/planovani/potvrdit — batch zápis plannedFor po potvrzení AI návrhu */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  let updated = 0;
  for (const a of parsed.data.assignments) {
    const r = await prisma.task.updateMany({
      where: { id: a.taskId, userId: session.uid, status: "open" },
      data: { plannedFor: new Date(`${a.date}T00:00:00`) },
    });
    updated += r.count;
  }
  return Response.json({ ok: true, updated });
};
