import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processJournalAudio, structureJournalEntry } from "@/lib/process-journal-audio";

export const prerender = false;

/**
 * POST /api/denik/:id/regenerate
 * Body: { mode?: "structure-only" | "full" }
 *
 * - structure-only: znovu Stage 2 nad existujícím rawTranscript (rychlé)
 * - full: re-run od audio (pokud existuje na disku)
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const entry = await prisma.journalEntry.findFirst({ where: { id, userId: session.uid } });
  if (!entry) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "full" ? "full" : "structure-only";

  if (mode === "structure-only" && entry.rawTranscript) {
    await prisma.journalEntry.update({
      where: { id },
      data: { status: "processing", processingError: null },
    });

    void (async () => {
      try {
        const structured = await structureJournalEntry(entry.rawTranscript!);
        await prisma.journalEntry.update({
          where: { id },
          data: {
            title: structured.title,
            bodyMarkdown: structured.bodyMarkdown,
            mood: structured.mood as never,
            tags: structured.tags,
            people: structured.people,
            highlights: structured.highlights,
            status: "ready",
          },
        });
      } catch (e) {
        await prisma.journalEntry.update({
          where: { id },
          data: { status: "error", processingError: e instanceof Error ? e.message : String(e) },
        });
      }
    })();

    return Response.json({ ok: true, mode, status: "processing" });
  }

  if (!entry.audioPath || !(await uploadExists(entry.audioPath))) {
    return Response.json({ error: "Audio už není na disku — full regenerate nelze." }, { status: 410 });
  }

  await prisma.journalEntry.update({
    where: { id },
    data: { status: "processing", processingError: null, rawTranscript: null },
  });

  const audio = await readUpload(entry.audioPath);
  void processJournalAudio({ entryId: id, audio, mimeType: entry.audioMime ?? "audio/webm" });

  return Response.json({ ok: true, mode: "full", status: "processing" });
};
