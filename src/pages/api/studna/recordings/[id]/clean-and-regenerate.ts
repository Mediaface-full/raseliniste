import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, saveUpload, deleteUpload } from "@/lib/uploads";
import { cleanAudioForTranscription } from "@/lib/audio-clean";
import { processRecording, processUploadAudio } from "@/lib/process-recording";

export const prerender = false;

/**
 * POST /api/studna/recordings/:id/clean-and-regenerate
 *
 * Petr 2026-05-16: Když Gemini selže kvůli hudbě/šumu v pozadí, tenhle endpoint
 * pustí ffmpeg cleanup (highpass + lowpass + dynaudnorm) přes uložené audio,
 * uloží výsledný čistý MP3 zpět na disk, smaže původní, a triggerne pipeline
 * znovu nad očištěnou verzí.
 *
 * Pozor: destruktivní operace. Původní audio se přepíše vyčištěnou MP3
 * verzí. Pokud Petr chce zachovat original, musí si ho předtím stáhnout
 * (tlačítko Stáhnout v záznamu).
 *
 * Synchronní část: jen cleanup (ffmpeg ~5-30 s).
 * Fire-and-forget: AI pipeline na pozadí.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const recording = await prisma.projectRecording.findFirst({
    where: { id, project: { userId: session.uid } },
    include: {
      project: { select: { id: true, description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true } },
    },
  });
  if (!recording) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!recording.audioPath) {
    return Response.json({ error: "Záznam nemá audio soubor." }, { status: 400 });
  }

  let originalBuf: Buffer;
  try {
    originalBuf = await readUpload(recording.audioPath);
  } catch (e) {
    return Response.json(
      { error: `Audio se nepodařilo načíst (možná smazaný cleanup cronem): ${e instanceof Error ? e.message : String(e)}` },
      { status: 410 },
    );
  }

  // Spustit ffmpeg cleanup
  let cleaned;
  try {
    cleaned = await cleanAudioForTranscription(originalBuf, recording.audioMime ?? "audio/webm");
  } catch (e) {
    return Response.json(
      { error: `ffmpeg cleanup selhal: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // Uložit vyčištěný MP3 na disk pod stejnou subdir
  let saved;
  try {
    saved = await saveUpload(`studna/${recording.project.id}`, cleaned.cleanedBuffer, cleaned.mimeType);
  } catch (e) {
    return Response.json({ error: `Uložení vyčištěného audio selhalo: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  // Smazat starý audio (best-effort, až po úspěšném uložení nového)
  const oldPath = recording.audioPath;
  try { await deleteUpload(oldPath); } catch { /* ignore */ }

  await prisma.projectRecording.update({
    where: { id },
    data: {
      audioPath: saved.relativePath,
      audioMime: cleaned.mimeType,
      audioBytes: saved.bytes,
      uploadedFilename: (recording.uploadedFilename ?? "audio") + " (vyčištěno)",
      status: "processing",
      processingError: null,
      transcript: "",
      analysis: undefined,
    },
  });

  // AI pipeline znovu nad vyčištěnou verzí
  if (recording.type === "UPLOAD") {
    void processUploadAudio({
      recordingId: id,
      audio: cleaned.cleanedBuffer,
      mimeType: cleaned.mimeType,
      projectContext: recording.project.description,
    });
  } else {
    void processRecording({
      recordingId: id,
      audio: cleaned.cleanedBuffer,
      mimeType: cleaned.mimeType,
      type: recording.type as "STANDARD" | "BRIEF",
      projectContext: recording.project.description,
      customStandardPrompt: recording.project.studnaStandardPrompt,
      customBriefPrompt: recording.project.studnaBriefPrompt,
      analysisModel: recording.project.analysisModel,
    });
  }

  return Response.json({
    ok: true,
    recordingId: id,
    status: "processing",
    originalBytes: cleaned.originalBytes,
    cleanedBytes: cleaned.cleanedBytes,
    compressionRatio: (cleaned.cleanedBytes / cleaned.originalBytes).toFixed(2),
  });
};
