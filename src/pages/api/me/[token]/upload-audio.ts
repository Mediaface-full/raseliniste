import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/uploads";
import { processUploadAudio } from "@/lib/process-recording";
import { resolveAudioMime } from "@/lib/audio-mime";

export const prerender = false;

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const RATE_LIMIT_PER_GUEST = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return clientAddress ?? "unknown";
}

/**
 * POST /api/me/:token/upload-audio
 *   Multipart upload audio souboru jako UPLOAD recording.
 *   Form fields: projectId, file
 *
 *   Vyžaduje invitation.canUploadAudio=true. Bez tohoto flagu 403.
 *   Spustí JEN Stage 1 přepis na pozadí (žádná Stage 2 analýza).
 */
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  const token = params.token;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const guest = await prisma.guestUser.findUnique({ where: { guestToken: token } });
  if (!guest) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const ip = clientIp(request, clientAddress);
  const ua = request.headers.get("user-agent") ?? null;

  // Rate limit per host
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await prisma.projectRecording.count({
    where: { guestUserId: guest.id, createdAt: { gte: since } },
  });
  if (recentCount >= RATE_LIMIT_PER_GUEST) {
    return Response.json(
      { error: `Limit ${RATE_LIMIT_PER_GUEST} nahrávek/hodinu vyčerpán. Zkus to za chvíli.` },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!projectId) return Response.json({ error: "INVALID_PROJECT" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 });
  }
  // iPhone Files app často pošle prázdný file.type — odvodíme MIME z přípony.
  const mime = resolveAudioMime(file.type, file.name);
  if (!mime) {
    return Response.json(
      {
        error: `Soubor není rozpoznán jako audio (mime: "${file.type || "prázdný"}", filename: "${file.name || "?"}"). Podporované formáty: m4a, mp3, wav, ogg, opus, aac, webm, mp4, flac.`,
      },
      { status: 400 },
    );
  }

  // Ověř invitation + permission flag
  const invitation = await prisma.projectInvitation.findUnique({
    where: { projectId_guestUserId: { projectId, guestUserId: guest.id } },
    include: { project: { select: { id: true, description: true, archivedAt: true } } },
  });
  if (!invitation || invitation.project.archivedAt) {
    return Response.json({ error: "Nejsi pozván do tohoto projektu." }, { status: 403 });
  }
  if (!invitation.canUploadAudio) {
    return Response.json({ error: "Pro tento projekt nemáš oprávnění nahrávat audio soubory." }, { status: 403 });
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
      guestUserId: guest.id,
      isOwner: false,
      authorName: guest.name,
      type: "UPLOAD",
      audioPath: saved.relativePath,
      audioMime: mime,
      audioBytes: saved.bytes,
      transcript: "",
      status: "processing",
      uploadedFilename: originalName,
      ip,
      userAgent: ua,
    },
  });

  void processUploadAudio({
    recordingId: recording.id,
    audio: buf,
    mimeType: mime,
    projectContext: invitation.project.description,
  });

  return Response.json({ ok: true, recordingId: recording.id });
};
