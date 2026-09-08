import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { processTaskAudio } from "@/lib/process-task-audio";

export const prerender = false;

const MAX_CHARS = 200_000;
const schema = z.object({ text: z.string().min(1).max(MAX_CHARS) });

/**
 * POST /api/ukoly/text — Gideon 2026-09-08 („musím mít možnost vložit přepis,
 * ne jen audio"). JSON { text }. Založí TaskAudioBatch bez audia s hotovým
 * rawTranscript a pustí jen Stage 2 (extrakce úkolů) → review jako u diktátu.
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

  const batch = await prisma.taskAudioBatch.create({
    data: { userId: session.uid, rawTranscript: text, status: "processing" },
  });

  void processTaskAudio({ batchId: batch.id, transcript: text });

  return Response.json({ batchId: batch.id, status: "processing" });
};
