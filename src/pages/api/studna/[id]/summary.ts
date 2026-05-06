import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { summarizeProject } from "@/lib/project-summary";

export const prerender = false;

/**
 * POST /api/studna/:id/summary
 *   Vytvoří strukturovaný AI souhrn projektu (Gemini Pro), uloží do DB,
 *   vrátí markdown text. Bere VŠECHNY processed záznamy (briefy primární).
 *
 *   Nemá rate limit per se — owner si může klikat kolikrát chce, jen ho to
 *   stojí $0.05-$0.20 per call.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const recordings = await prisma.projectRecording.findMany({
    where: { projectId, status: "processed" },
    select: {
      authorName: true,
      type: true,
      createdAt: true,
      transcript: true,
      analysis: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (recordings.length === 0) {
    return Response.json({ error: "Projekt zatím neobsahuje zpracované záznamy." }, { status: 400 });
  }

  // Fire-and-forget — Gemini Pro nad full transcripts může trvat 30-120 s.
  // Vytvoříme placeholder s status=processing, AI běží na pozadí, UI polluje.
  const placeholder = await prisma.projectSummary.create({
    data: {
      projectId,
      text: "",
      model: "gemini-2.5-pro",
      recordingsIncluded: recordings.length,
      briefsIncluded: recordings.filter((r) => r.type === "BRIEF").length,
      status: "processing",
    },
  });

  void runProjectSummary(placeholder.id, projectId, project.name, project.description, project.projectSummaryPrompt, recordings);

  return Response.json({ summary: placeholder, processing: true });
};

const inFlight = new Set<Promise<void>>();

async function runProjectSummary(
  summaryId: string,
  projectId: string,
  projectName: string,
  projectDescription: string | null,
  customPrompt: string | null,
  recordings: Array<{
    authorName: string;
    type: string;
    createdAt: Date;
    transcript: string;
    analysis: unknown;
  }>,
): Promise<void> {
  const p = (async () => {
    try {
      const result = await summarizeProject({
        projectName,
        projectDescription,
        customPrompt,
        recordings: recordings.map((r) => ({
          authorName: r.authorName,
          type: r.type as "STANDARD" | "BRIEF",
          createdAt: r.createdAt,
          transcript: r.transcript,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          analysis: r.analysis as any,
        })),
      });

      await prisma.projectSummary.update({
        where: { id: summaryId },
        data: {
          text: result.text,
          model: result.model,
          recordingsIncluded: result.recordingsIncluded,
          briefsIncluded: result.briefsIncluded,
          status: "ready",
          processingError: null,
        },
      });
      void projectId;
      console.log(`[studna summary bg] ${summaryId} processed OK`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[studna summary bg] ${summaryId} failed:`, msg);
      try {
        await prisma.projectSummary.update({
          where: { id: summaryId },
          data: { status: "error", processingError: msg.slice(0, 1000) },
        });
      } catch {}
    } finally {
      inFlight.delete(p);
    }
  })();
  inFlight.add(p);
  return p;
}
