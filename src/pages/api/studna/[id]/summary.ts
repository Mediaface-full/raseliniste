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

  try {
    const result = await summarizeProject({
      projectName: project.name,
      projectDescription: project.description,
      customPrompt: project.projectSummaryPrompt,
      recordings: recordings.map((r) => ({
        authorName: r.authorName,
        type: r.type as "STANDARD" | "BRIEF",
        createdAt: r.createdAt,
        transcript: r.transcript,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysis: r.analysis as any,
      })),
    });

    const summary = await prisma.projectSummary.create({
      data: {
        projectId,
        text: result.text,
        model: result.model,
        recordingsIncluded: result.recordingsIncluded,
        briefsIncluded: result.briefsIncluded,
      },
    });

    return Response.json({ summary });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
