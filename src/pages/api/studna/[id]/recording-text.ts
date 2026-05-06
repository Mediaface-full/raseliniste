import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { processRecordingFromText } from "@/lib/process-recording";

export const prerender = false;

const Body = z.object({
  type: z.enum(["STANDARD", "BRIEF"]),
  text: z.string().min(20).max(200_000),
});

/**
 * POST /api/studna/:id/recording-text
 *   Owner-only (admin). Vloží textový přepis (např. zápis schůzky) jako
 *   ProjectRecording. Přeskočí Stage 1 (audio přepis) — text je vstup —
 *   a spustí jen Stage 2 (AI analýza).
 *
 *   Body JSON: { type: "STANDARD" | "BRIEF", text: string }
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid, archivedAt: null },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { username: true },
  });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError
      ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  // Vytvoř recording rovnou s transcriptem; audioPath=null (text-only).
  const recording = await prisma.projectRecording.create({
    data: {
      projectId,
      guestUserId: null,
      isOwner: true,
      authorName: user?.username ?? "owner",
      type: body.type,
      audioPath: null,
      audioMime: null,
      audioBytes: null,
      audioDurationSec: null,
      transcript: body.text,
      status: "processing",
    },
  });

  // Fire-and-forget — Stage 2 analýza nad textem.
  void processRecordingFromText({
    recordingId: recording.id,
    transcript: body.text,
    type: body.type,
    projectContext: project.description,
    customStandardPrompt: project.studnaStandardPrompt,
    customBriefPrompt: project.studnaBriefPrompt,
    analysisModel: project.analysisModel,
  });

  return Response.json({ ok: true, recordingId: recording.id, status: "processing" });
};
