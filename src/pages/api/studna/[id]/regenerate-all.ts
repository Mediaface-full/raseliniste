import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { processRecordingFromText } from "@/lib/process-recording";

export const prerender = false;

/**
 * POST /api/studna/:projectId/regenerate-all
 *
 * Hromadná regenerace AI analýzy pro VŠECHNY záznamy v projektu, které mají
 * transcript. Spouští JEN Stage 2 (analýza) — nepřepisuje audio znovu, takže
 * je to rychlé a levné. Použití: Petr upravil custom prompt projektu a chce
 * aplikovat na všechny existující záznamy bez ručního klikání po jednom.
 *
 * UPLOAD type přeskakujeme (žádná Stage 2 analýza u uploadu).
 *
 * Async: vrátí počet okamžitě, AI běží na pozadí (každý záznam → "processing"
 * → "processed").
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid, archivedAt: null },
    select: { id: true, description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const recordings = await prisma.projectRecording.findMany({
    where: {
      projectId,
      transcript: { not: null },
      type: { in: ["STANDARD", "BRIEF"] },
    },
    select: { id: true, transcript: true, type: true },
  });

  if (recordings.length === 0) {
    return Response.json({ ok: true, count: 0, message: "Žádné záznamy s přepisem k regeneraci." });
  }

  // Označit jako processing → frontend okamžitě vidí změnu stavu
  await prisma.projectRecording.updateMany({
    where: { id: { in: recordings.map((r) => r.id) } },
    data: { status: "processing", processingError: null },
  });

  // Fire-and-forget pro každý záznam (Stage 2 only nad textovým transcriptem)
  for (const rec of recordings) {
    if (!rec.transcript) continue;
    void processRecordingFromText({
      recordingId: rec.id,
      transcript: rec.transcript,
      type: rec.type as "STANDARD" | "BRIEF",
      projectContext: project.description,
      customStandardPrompt: project.studnaStandardPrompt,
      customBriefPrompt: project.studnaBriefPrompt,
      analysisModel: project.analysisModel,
    });
  }

  return Response.json({ ok: true, count: recordings.length });
};
