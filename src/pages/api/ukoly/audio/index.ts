import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { processTaskAudio } from "@/lib/process-task-audio";

export const prerender = false;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — úkolová salva by neměla být víc než pár min

/**
 * POST /api/ukoly/audio
 * multipart: audio (File), durationSec?
 *
 * Uloží audio na disk + vytvoří TaskAudioBatch ve stavu "processing".
 * Vrátí { batchId, status: "processing" } hned.
 * AI zpracování běží na pozadí — UI poll na GET /api/ukoly/audio/:id.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await request.formData();
  const audioFile = form.get("audio");
  const durationRaw = form.get("durationSec");
  const durationSec = durationRaw ? Math.round(Number(durationRaw)) : null;

  if (!(audioFile instanceof File)) {
    return Response.json({ error: "Chybí audio soubor." }, { status: 400 });
  }
  if (audioFile.size > MAX_BYTES) {
    return Response.json(
      { error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  const audioBuf = Buffer.from(await audioFile.arrayBuffer());
  const saved = await saveUpload(`ukoly-audio/${session.uid}`, audioBuf, audioFile.type || "audio/webm");

  const batch = await prisma.taskAudioBatch.create({
    data: {
      userId: session.uid,
      audioPath: saved.relativePath,
      audioMime: audioFile.type || "audio/webm",
      audioBytes: saved.bytes,
      audioDurationSec: durationSec,
      status: "processing",
    },
  });

  // Fire-and-forget AI processing
  void processTaskAudio({
    batchId: batch.id,
    audio: audioBuf,
    mimeType: audioFile.type || "audio/webm",
  });

  return Response.json({ batchId: batch.id, status: "processing" });
};
