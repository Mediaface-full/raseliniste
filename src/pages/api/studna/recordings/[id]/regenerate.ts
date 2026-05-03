import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processRecording } from "@/lib/process-recording";

export const prerender = false;

/**
 * POST /api/studna/recordings/:id/regenerate
 *
 * Záchranná brzda — vezme uložené audio z disku a spustí AI processing
 * znovu. Použít když recording skončí ve status="error" nebo má prázdnou
 * analýzu (transient Gemini chyba, network blip, atd.).
 *
 * Async: vrátí OK hned, AI běží na pozadí (status → "processing" → "processed").
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const recording = await prisma.projectRecording.findFirst({
    where: { id, project: { userId: session.uid } },
    include: { project: { select: { description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true } } },
  });
  if (!recording) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!recording.audioPath || !(await uploadExists(recording.audioPath))) {
    return Response.json(
      { error: "Audio soubor už není na disku (možná jej smazal cleanup cron). Regenerace nelze." },
      { status: 410 },
    );
  }

  // Reset stavu na processing + smazat starou chybu
  await prisma.projectRecording.update({
    where: { id },
    data: { status: "processing", processingError: null },
  });

  // Načti audio z disku
  let audio: Buffer;
  try {
    audio = await readUpload(recording.audioPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.projectRecording.update({
      where: { id },
      data: { status: "error", processingError: `Načtení audio z disku selhalo: ${msg}` },
    });
    return Response.json({ error: msg }, { status: 500 });
  }

  // Fire-and-forget — vrátíme OK hned, AI běží na pozadí.
  void processRecording({
    recordingId: id,
    audio,
    mimeType: recording.audioMime ?? "audio/webm",
    type: recording.type as "STANDARD" | "BRIEF",
    projectContext: recording.project.description,
    customStandardPrompt: recording.project.studnaStandardPrompt,
    customBriefPrompt: recording.project.studnaBriefPrompt,
    analysisModel: recording.project.analysisModel,
  });

  return Response.json({ ok: true, recordingId: id, status: "processing" });
};
