import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { processRecording, processUploadAudio } from "@/lib/process-recording";
import { resolveAudioMime } from "@/lib/audio-mime";

export const prerender = false;

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * POST /api/studna/recordings/:id/replace-audio
 *
 * Admin-only re-upload existujícího záznamu. Použití: Gemini selhalo na
 * původním souboru (poškozený kodek, nepodporovaný mime), Petr soubor stáhne,
 * zkonvertuje lokálně (např. ffmpeg → mp3) a nahraje znovu pod stejné ID.
 *
 * Krok za krokem:
 *   1. Owner check (přes project.userId)
 *   2. Smaže starý audio z disku (best-effort)
 *   3. Uloží nový audio, aktualizuje audioPath/mime/bytes/uploadedFilename
 *   4. Status → processing, processingError → null
 *   5. Triggerne pipeline podle typu (STANDARD/BRIEF → processRecording,
 *      UPLOAD → processUploadAudio) fire-and-forget
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
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

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 });
  }
  const mime = resolveAudioMime(file.type, file.name);
  if (!mime) {
    return Response.json(
      { error: `Soubor není rozpoznán jako audio (mime: "${file.type || "prázdný"}", filename: "${file.name || "?"}").` },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const originalName = file.name || "reupload.audio";

  // Uložit nový — pokud selže, starý zůstává nedotčený.
  let saved;
  try {
    saved = await saveUpload(`studna/${recording.project.id}`, buf, mime);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Uložení selhalo." }, { status: 400 });
  }

  // Smazat starý (best-effort, po úspěšném uložení nového)
  const oldPath = recording.audioPath;
  if (oldPath) {
    try { await deleteUpload(oldPath); } catch { /* best-effort */ }
  }

  await prisma.projectRecording.update({
    where: { id },
    data: {
      audioPath: saved.relativePath,
      audioMime: mime,
      audioBytes: saved.bytes,
      uploadedFilename: originalName,
      status: "processing",
      processingError: null,
      // Smazat starý přepis i analýzu — bude nový pipeline run
      transcript: "",
      analysis: undefined,
    },
  });

  // Triggernout pipeline podle typu záznamu
  if (recording.type === "UPLOAD") {
    void processUploadAudio({
      recordingId: id,
      audio: buf,
      mimeType: mime,
      projectContext: recording.project.description,
    });
  } else {
    void processRecording({
      recordingId: id,
      audio: buf,
      mimeType: mime,
      type: recording.type as "STANDARD" | "BRIEF",
      projectContext: recording.project.description,
      customStandardPrompt: recording.project.studnaStandardPrompt,
      customBriefPrompt: recording.project.studnaBriefPrompt,
      analysisModel: recording.project.analysisModel,
    });
  }

  return Response.json({ ok: true, recordingId: id, status: "processing", bytes: saved.bytes, mime });
};
