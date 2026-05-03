import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/studna/recordings/:id/mark-error
 *
 * Manuální záchrana — Petr v UI klikne "Zrušit zpracování" na recording,
 * který uvázl ve status="processing" (Promise umřela při restartu kontejneru,
 * Gemini vrátil neplatný JSON kvůli custom promptu, atd.).
 *
 * Po tomhle endpointu může Petr kliknout "Regenerovat" a zkusit znovu —
 * případně předtím vypnout/upravit custom AI prompt v projektu.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const recording = await prisma.projectRecording.findFirst({
    where: { id, project: { userId: session.uid } },
    select: { id: true, status: true },
  });
  if (!recording) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (recording.status !== "processing") {
    return Response.json(
      { error: "NOT_PROCESSING", currentStatus: recording.status },
      { status: 409 }
    );
  }

  const updated = await prisma.projectRecording.update({
    where: { id },
    data: {
      status: "error",
      processingError: "Manuálně zrušeno uživatelem (zpracování viselo).",
    },
  });

  return Response.json({ ok: true, recording: { id: updated.id, status: updated.status } });
};
