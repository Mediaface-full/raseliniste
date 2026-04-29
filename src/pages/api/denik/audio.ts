import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { processJournalAudio } from "@/lib/process-journal-audio";

export const prerender = false;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB pro 60min upload (Plaud apod.)

/**
 * POST /api/denik/audio
 * multipart: audio (File), date? (YYYY-MM-DD), durationSec?
 *
 * Uloží audio + vytvoří JournalEntry status=processing.
 * Vrátí { entryId, status: "processing" } hned.
 * AI běží na pozadí (in-flight Set pin pattern).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await request.formData();
  const audioFile = form.get("audio");
  const dateRaw = form.get("date") as string | null;
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

  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
    ? new Date(`${dateRaw}T00:00:00`)
    : new Date();
  date.setHours(0, 0, 0, 0);

  const audioBuf = Buffer.from(await audioFile.arrayBuffer());
  const saved = await saveUpload(`denik/${session.uid}`, audioBuf, audioFile.type || "audio/webm");

  const entry = await prisma.journalEntry.create({
    data: {
      userId: session.uid,
      date,
      bodyMarkdown: "",
      audioPath: saved.relativePath,
      audioMime: audioFile.type || "audio/webm",
      audioBytes: saved.bytes,
      audioDurationSec: durationSec,
      status: "processing",
    },
  });

  void processJournalAudio({
    entryId: entry.id,
    audio: audioBuf,
    mimeType: audioFile.type || "audio/webm",
  });

  return Response.json({ entryId: entry.id, status: "processing" });
};
