import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { processRecording } from "@/lib/process-recording";

export const prerender = false;

const MAX_STANDARD_BYTES = 50 * 1024 * 1024;
const MAX_BRIEF_BYTES = 500 * 1024 * 1024;

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

/**
 * POST /api/studna/:id/recording
 *   Owner-only nahrávání do projektu. Identita = aktuálně přihlášený user.
 *   multipart/form-data: type, audio, durationSec?
 */
export const POST: APIRoute = async ({ request, cookies, params, clientAddress }) => {
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
  const typeStr = String(form.get("type") ?? "STANDARD");
  const audioFile = form.get("audio");
  const durationRaw = form.get("durationSec");
  const durationSec = durationRaw ? Math.round(Number(durationRaw)) : null;

  if (typeStr !== "STANDARD" && typeStr !== "BRIEF") {
    return Response.json({ error: "INVALID_TYPE" }, { status: 400 });
  }
  if (!(audioFile instanceof File)) {
    return Response.json({ error: "Chybí audio soubor." }, { status: 400 });
  }
  const maxBytes = typeStr === "BRIEF" ? MAX_BRIEF_BYTES : MAX_STANDARD_BYTES;
  if (audioFile.size > maxBytes) {
    return Response.json(
      { error: `Soubor je moc velký (max ${maxBytes / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  const ip = clientIp(request, clientAddress);
  const ua = request.headers.get("user-agent") ?? null;

  const audioBuf = Buffer.from(await audioFile.arrayBuffer());
  const saved = await saveUpload(`studna/${projectId}`, audioBuf, audioFile.type || "audio/webm");

  const recording = await prisma.projectRecording.create({
    data: {
      projectId,
      guestUserId: null,
      isOwner: true,
      authorName: user?.username ?? "owner",
      type: typeStr,
      audioPath: saved.relativePath,
      audioMime: audioFile.type || "audio/webm",
      audioBytes: saved.bytes,
      audioDurationSec: durationSec,
      transcript: "",
      status: "processing",
      ip,
      userAgent: ua,
    },
  });

  // Fire-and-forget AI zpracování — uživatel dostane OK hned, AI běží na pozadí.
  // Až se zpracuje, status se update na "processed" nebo "error".
  void processRecording({
    recordingId: recording.id,
    audio: audioBuf,
    mimeType: audioFile.type || "audio/webm",
    type: typeStr,
    projectContext: project.description,
  });

  return Response.json({ ok: true, recordingId: recording.id, status: "processing" });
};
