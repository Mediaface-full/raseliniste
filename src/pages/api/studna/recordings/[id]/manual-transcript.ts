import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { processRecordingFromText } from "@/lib/process-recording";

export const prerender = false;

/**
 * POST /api/studna/recordings/:id/manual-transcript
 *
 * Petr 2026-05-16: Když Gemini selže přepsat audio (hudba v pozadí, šum),
 * Petr poslechne audio sám a napíše přepis ručně. Endpoint vezme jeho text,
 * uloží jako transcript, a spustí Stage 2 (AI analýzu) nad textem.
 *
 * Záznam zůstává patřit původnímu autorovi (authorName se nemění) — Petr
 * je jen ten kdo doplnil přepis.
 *
 * Body: { transcript: string, runAnalysis?: boolean }
 *   - runAnalysis default true: spustí AI analýzu (summary, themes, ...).
 *     Pokud false, jen uloží přepis bez Stage 2.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { transcript?: string; runAnalysis?: boolean };
  const transcript = (body.transcript ?? "").trim();
  if (!transcript) return Response.json({ error: "Přepis je prázdný." }, { status: 400 });
  if (transcript.length > 200_000) {
    return Response.json({ error: "Přepis je moc dlouhý (max 200 000 znaků)." }, { status: 400 });
  }

  const recording = await prisma.projectRecording.findFirst({
    where: { id, project: { userId: session.uid } },
    include: {
      project: { select: { description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true } },
    },
  });
  if (!recording) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const runAnalysis = body.runAnalysis !== false; // default true

  if (recording.type === "UPLOAD" || !runAnalysis) {
    // UPLOAD nemá Stage 2 analýzu — jen uložíme přepis.
    await prisma.projectRecording.update({
      where: { id },
      data: {
        transcript,
        status: "processed",
        processingError: null,
      },
    });
    return Response.json({ ok: true, status: "processed", analysisRan: false });
  }

  // STANDARD/BRIEF — spustí Stage 2 nad textem fire-and-forget
  await prisma.projectRecording.update({
    where: { id },
    data: {
      transcript,
      status: "processing",
      processingError: null,
    },
  });

  void processRecordingFromText({
    recordingId: id,
    transcript,
    type: recording.type as "STANDARD" | "BRIEF",
    projectContext: recording.project.description,
    customStandardPrompt: recording.project.studnaStandardPrompt,
    customBriefPrompt: recording.project.studnaBriefPrompt,
    analysisModel: recording.project.analysisModel,
  });

  return Response.json({ ok: true, status: "processing", analysisRan: true });
};
