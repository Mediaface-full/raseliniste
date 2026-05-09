import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { processUploadAudio } from "@/lib/process-recording";

export const prerender = false;

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_AUDIO_PREFIX = "audio/";

/**
 * POST /api/studna/:id/upload-audio
 *   Owner-only. Multipart upload audio souboru jako UPLOAD recording.
 *   Spustí JEN Stage 1 přepis na pozadí (žádná Stage 2 analýza).
 *   Funguje pro Studánku i Prskavku — jen owner check.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid, archivedAt: null },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { username: true },
  });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 });
  }
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith(ALLOWED_AUDIO_PREFIX)) {
    return Response.json({ error: `Soubor není audio (mime: ${mime || "neznámý"}).` }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const originalName = file.name || "upload.audio";

  let saved;
  try {
    saved = await saveUpload(`studna/${projectId}`, buf, mime);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Uložení selhalo." }, { status: 400 });
  }

  const recording = await prisma.projectRecording.create({
    data: {
      projectId,
      guestUserId: null,
      isOwner: true,
      authorName: user?.username ?? "owner",
      type: "UPLOAD",
      audioPath: saved.relativePath,
      audioMime: mime,
      audioBytes: saved.bytes,
      transcript: "",
      status: "processing",
      uploadedFilename: originalName,
    },
  });

  void processUploadAudio({
    recordingId: recording.id,
    audio: buf,
    mimeType: mime,
    projectContext: project.description,
  });

  return Response.json({ ok: true, recordingId: recording.id, status: "processing" });
};
