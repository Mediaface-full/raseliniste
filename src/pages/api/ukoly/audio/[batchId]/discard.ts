import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * POST /api/ukoly/audio/:batchId/discard
 * Petr v review odmítl všechno — smažeme audio i transcript.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.batchId as string;
  const batch = await prisma.taskAudioBatch.findFirst({
    where: { id, userId: session.uid },
  });
  if (!batch) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (batch.audioPath) {
    await deleteUpload(batch.audioPath).catch(() => null);
  }

  await prisma.taskAudioBatch.update({
    where: { id },
    data: {
      status: "discarded",
      reviewedAt: new Date(),
      audioPath: null,
      rawTranscript: null,
      proposalsJson: undefined,
    },
  });

  return Response.json({ ok: true });
};
