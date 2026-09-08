import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { processJournalAudio } from "@/lib/process-journal-audio";

export const prerender = false;

const MAX_CHARS = 200_000;
const schema = z.object({
  text: z.string().min(1).max(MAX_CHARS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * POST /api/denik/text — Gideon 2026-09-08. JSON { text, date? }.
 * Založí JournalEntry bez audia s hotovým rawTranscript a pustí jen Stage 2
 * (strukturování) → zápis se objeví v Deníku jako po diktátu.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Chybí text (max ${MAX_CHARS.toLocaleString("cs-CZ")} znaků).` }, { status: 400 });
  }
  const text = parsed.data.text.trim();
  if (!text) return Response.json({ error: "Text je prázdný." }, { status: 400 });

  const date = parsed.data.date ? new Date(`${parsed.data.date}T00:00:00`) : new Date();
  date.setHours(0, 0, 0, 0);

  const entry = await prisma.journalEntry.create({
    data: { userId: session.uid, date, bodyMarkdown: "", rawTranscript: text, status: "processing" },
  });

  void processJournalAudio({ entryId: entry.id, transcript: text });

  return Response.json({ entryId: entry.id, status: "processing" });
};
