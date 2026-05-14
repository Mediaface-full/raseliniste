import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processRecording, processUploadAudio } from "@/lib/process-recording";
import { resolveAudioMime } from "@/lib/audio-mime";

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

  // Petr 2026-05-14: stará nahrávka má v DB audio/x-m4a (Apple Voice Memos),
  // Gemini odmítá s 400 INVALID_ARGUMENT. Re-normalize MIME před retry — pokud
  // se změnil, persist do DB ať příští retry už používá správný.
  const normalizedMime = resolveAudioMime(recording.audioMime, recording.uploadedFilename ?? recording.audioPath ?? null) ?? recording.audioMime ?? "audio/webm";
  if (normalizedMime !== recording.audioMime) {
    await prisma.projectRecording.update({
      where: { id },
      data: { audioMime: normalizedMime },
    });
    console.log(`[regenerate] ${id} mime fix ${recording.audioMime} → ${normalizedMime}`);
  }

  // Fire-and-forget — vrátíme OK hned, AI běží na pozadí.
  // UPLOAD type = jen Stage 1 přepis, STANDARD/BRIEF = full Stage 1+2 pipeline.
  if (recording.type === "UPLOAD") {
    void processUploadAudio({
      recordingId: id,
      audio,
      mimeType: normalizedMime,
      projectContext: recording.project.description,
    });
  } else {
    void processRecording({
      recordingId: id,
      audio,
      mimeType: normalizedMime,
      type: recording.type as "STANDARD" | "BRIEF",
      projectContext: recording.project.description,
      customStandardPrompt: recording.project.studnaStandardPrompt,
      customBriefPrompt: recording.project.studnaBriefPrompt,
      analysisModel: recording.project.analysisModel,
    });
  }

  return Response.json({ ok: true, recordingId: id, status: "processing" });
};
