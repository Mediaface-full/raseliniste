import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/uploads";
import { processRecording } from "@/lib/process-recording";

export const prerender = false;

const MAX_STANDARD_MS = 11 * 60 * 1000; // 11 min hard cap (10 min limit + buffer)
const MAX_STANDARD_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_BRIEF_BYTES = 500 * 1024 * 1024; // 500 MB pro 90 min audio

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 h
const RATE_LIMIT_PER_GUEST = 20;

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

/**
 * POST /api/me/:token/recording
 *   multipart/form-data:
 *     - projectId: cuid
 *     - type: "STANDARD" | "BRIEF"
 *     - audio: File
 *     - durationSec?: number (informativní)
 *
 *   Vrátí { recording: {...} } po úspěšném zpracování, nebo error.
 *   Zpracování je SYNCHRONNÍ (čekáme na Gemini transcribe). U dlouhých briefů
 *   to trvá 30-90 s — frontend musí mít odpovídající timeout.
 */
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  const token = params.token;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const guest = await prisma.guestUser.findUnique({
    where: { guestToken: token },
  });
  if (!guest) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const ip = clientIp(request, clientAddress);
  const ua = request.headers.get("user-agent") ?? null;

  // Rate limit per host (přes IP nemá smysl, hosti můžou sdílet WiFi)
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
  const typeStr = String(form.get("type") ?? "STANDARD");
  const audioFile = form.get("audio");
  const durationRaw = form.get("durationSec");
  const durationSec = durationRaw ? Math.round(Number(durationRaw)) : null;
  // Volitelný textový vzkaz vedle nahrávky — pro URL, jména, čísla co se hlasem komolí.
  // Není AI analyzováno, jen archivováno k záznamu.
  const guestNoteRaw = form.get("guestNote");
  const guestNote =
    typeof guestNoteRaw === "string" && guestNoteRaw.trim().length > 0
      ? guestNoteRaw.trim().slice(0, 8000)
      : null;

  if (typeStr !== "STANDARD" && typeStr !== "BRIEF") {
    return Response.json({ error: "INVALID_TYPE" }, { status: 400 });
  }
  if (!projectId) return Response.json({ error: "INVALID_PROJECT" }, { status: 400 });
  if (!(audioFile instanceof File)) {
    return Response.json({ error: "Chybí audio soubor." }, { status: 400 });
  }

  // Ověř invitation: host musí být pozvaný do projektu, a pokud BRIEF, musí mít permission
  const invitation = await prisma.projectInvitation.findUnique({
    where: {
      projectId_guestUserId: { projectId, guestUserId: guest.id },
    },
    include: {
      project: { select: { id: true, name: true, description: true, archivedAt: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true } },
    },
  });
  if (!invitation || invitation.project.archivedAt) {
    return Response.json({ error: "Nejsi pozván do tohoto projektu." }, { status: 403 });
  }
  if (typeStr === "BRIEF" && !invitation.canRecordBrief) {
    return Response.json({ error: "Pro tento projekt nemáš oprávnění nahrát Klíčový brief." }, { status: 403 });
  }

  // Velikostní cap
  const maxBytes = typeStr === "BRIEF" ? MAX_BRIEF_BYTES : MAX_STANDARD_BYTES;
  if (audioFile.size > maxBytes) {
    return Response.json(
      {
        error: `Soubor je moc velký (${Math.round(audioFile.size / 1024 / 1024)} MB, limit ${maxBytes / 1024 / 1024} MB).`,
      },
      { status: 413 },
    );
  }

  // Standard má i délkový cap (jen orientační, klient by měl auto-stop na 10 min)
  if (typeStr === "STANDARD" && durationSec && durationSec * 1000 > MAX_STANDARD_MS) {
    return Response.json({ error: "Standardní záznam je delší než 10 min." }, { status: 413 });
  }

  // Ulož audio na disk
  const audioBuf = Buffer.from(await audioFile.arrayBuffer());
  let saved;
  try {
    saved = await saveUpload(`studna/${projectId}`, audioBuf, audioFile.type || "audio/webm");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  // Vytvoř recording v "processing" stavu
  const recording = await prisma.projectRecording.create({
    data: {
      projectId,
      guestUserId: guest.id,
      isOwner: false,
      authorName: guest.name,
      type: typeStr,
      audioPath: saved.relativePath,
      audioMime: audioFile.type || "audio/webm",
      audioBytes: saved.bytes,
      audioDurationSec: durationSec,
      transcript: "",
      guestNote,
      status: "processing",
      ip,
      userAgent: ua,
    },
  });

  // Fire-and-forget AI zpracování — host dostane OK hned ("nahráno, díky!"),
  // AI běží na pozadí. Petr v Studna admin uvidí status processed / error
  // až bude hotovo (viz polling v UI).
  void processRecording({
    recordingId: recording.id,
    audio: audioBuf,
    mimeType: audioFile.type || "audio/webm",
    type: typeStr,
    projectContext: invitation.project.description,
    customStandardPrompt: invitation.project.studnaStandardPrompt,
    customBriefPrompt: invitation.project.studnaBriefPrompt,
    analysisModel: invitation.project.analysisModel,
  });

  return Response.json({ ok: true, recordingId: recording.id, status: "processing" });
};
