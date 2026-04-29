import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  dueIsTime: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  rawSnippet: z.string().nullable().optional(),
  assignedToContactId: z.string().nullable().optional(),
});

const schema = z.object({
  proposals: z.array(proposalSchema).min(1),
});

/**
 * POST /api/ukoly/audio/:batchId/commit
 * Body: { proposals: [{ title, dueAt, ... }, ...] } — Petrem upravený seznam
 *
 * Vytvoří Task entries z předaných proposals, batch se označí "committed",
 * audio se smaže (transkript zůstane v batchi pro audit).
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.batchId as string;
  const batch = await prisma.taskAudioBatch.findFirst({
    where: { id, userId: session.uid },
  });
  if (!batch) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const created = await Promise.all(
    parsed.data.proposals.map((p) =>
      prisma.task.create({
        data: {
          userId: session.uid,
          title: p.title,
          notes: p.notes ?? null,
          dueAt: p.dueAt ? new Date(p.dueAt) : null,
          dueIsTime: p.dueIsTime ?? false,
          tags: p.tags ?? [],
          priority: p.priority ?? "normal",
          assignedToContactId: p.assignedToContactId ?? null,
          source: "audio",
          sourceBatchId: batch.id,
          rawSnippet: p.rawSnippet ?? null,
        },
      }),
    ),
  );

  // Audio smazat (úkoly jsou vytvořené, audio už není potřeba),
  // transkript zůstane pro audit.
  if (batch.audioPath) {
    await deleteUpload(batch.audioPath).catch(() => null);
  }

  await prisma.taskAudioBatch.update({
    where: { id },
    data: {
      status: "committed",
      reviewedAt: new Date(),
      audioPath: null,
    },
  });

  return Response.json({
    ok: true,
    createdTaskIds: created.map((t) => t.id),
    count: created.length,
  });
};
