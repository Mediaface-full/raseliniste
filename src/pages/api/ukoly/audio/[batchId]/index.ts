import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/ukoly/audio/:batchId
 * Vrátí stav batche pro polling z review UI.
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.batchId as string;
  const batch = await prisma.taskAudioBatch.findFirst({
    where: { id, userId: session.uid },
  });
  if (!batch) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json({
    batch: {
      id: batch.id,
      status: batch.status,
      rawTranscript: batch.rawTranscript,
      proposalsJson: batch.proposalsJson,
      processingError: batch.processingError,
      audioDurationSec: batch.audioDurationSec,
      createdAt: batch.createdAt,
      reviewedAt: batch.reviewedAt,
    },
  });
};
