import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processTaskAudio, extractTaskProposals } from "@/lib/process-task-audio";

export const prerender = false;

/**
 * POST /api/ukoly/audio/:batchId/regenerate
 * Body: { mode?: "extract-only" | "full" } (default: extract-only — pokud máme transcript)
 *
 * - extract-only: znovu zavolá Vertex Pro nad existujícím rawTranscript
 *   (rychlé, žádný audio re-upload). Vhodné když Petr chce zkusit jiný prompt
 *   nebo Vertex byl nahodil divně.
 * - full: znovu projde celou pipeline (audio → transcript → extract). Vhodné
 *   když rawTranscript chybí (Stage 1 selhal).
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
  const mode = body.mode === "full" ? "full" : "extract-only";

  if (mode === "extract-only" && batch.rawTranscript) {
    // Rychlá cesta — jen Stage 2
    await prisma.taskAudioBatch.update({
      where: { id },
      data: { status: "processing", processingError: null },
    });

    void (async () => {
      try {
        const proposals = await extractTaskProposals(batch.rawTranscript!, { userId: session.uid });
        await prisma.taskAudioBatch.update({
          where: { id },
          data: {
            proposalsJson: proposals as unknown as object,
            status: "review",
          },
        });
      } catch (e) {
        await prisma.taskAudioBatch.update({
          where: { id },
          data: { status: "error", processingError: e instanceof Error ? e.message : String(e) },
        });
      }
    })();

    return Response.json({ ok: true, mode, status: "processing" });
  }

  // Full re-run — potřebujeme audio z disku
  if (!batch.audioPath || !(await uploadExists(batch.audioPath))) {
    return Response.json(
      { error: "Audio už není na disku — full regenerate nelze." },
      { status: 410 },
    );
  }

  await prisma.taskAudioBatch.update({
    where: { id },
    data: { status: "processing", processingError: null, rawTranscript: null, proposalsJson: undefined },
  });

  const audio = await readUpload(batch.audioPath);
  void processTaskAudio({
    batchId: id,
    audio,
    mimeType: batch.audioMime ?? "audio/webm",
  });

  return Response.json({ ok: true, mode: "full", status: "processing" });
};
