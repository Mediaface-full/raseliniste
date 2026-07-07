import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  homeTitle: z.string().max(20).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  extractionPrompt: z.string().max(8000).nullable().optional(),
  studnaStandardPrompt: z.string().max(16000).nullable().optional(),
  studnaBriefPrompt: z.string().max(16000).nullable().optional(),
  projectSummaryPrompt: z.string().max(16000).nullable().optional(),
  // Per-projekt Gemini model pro Stage 2 analýzu. Whitelist hodnot — null = default.
  analysisModel: z.enum(["gemini-2.5-flash", "gemini-2.5-pro"]).nullable().optional(),
  includeInDigest: z.boolean().optional(),
  archive: z.boolean().optional(),
  // Integrace s externím systémem (SRO Manager) — Petr 2026-07-06
  webhookUrl: z.string().url().max(500).nullable().optional().or(z.literal("").transform(() => null)),
  webhookSecret: z.string().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  externalClientRef: z.string().max(120).nullable().optional().or(z.literal("").transform(() => null)),
});

async function own(userId: string, id: string) {
  return prisma.projectBox.findFirst({ where: { id, userId } });
}

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  // Defenzivní cleanup: ProjectSummary processing déle než 5 min → error
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.projectSummary.updateMany({
    where: { project: { id, userId: session.uid }, status: "processing", createdAt: { lt: staleCutoff } },
    data: { status: "error", processingError: "Souhrn nestihl doběhnout do 5 minut. Smaž a zkus znovu." },
  });

  const project = await prisma.projectBox.findFirst({
    where: { id, userId: session.uid },
    include: {
      invitations: {
        include: { guestUser: true },
        orderBy: { invitedAt: "desc" },
      },
      recordings: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          authorName: true,
          isOwner: true,
          type: true,
          status: true,
          processingError: true,
          audioPath: true,
          audioDurationSec: true,
          isPinned: true,
          analysis: true,
          transcript: true,
          guestNote: true,
          createdAt: true,
        },
      },
      summaries: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      files: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true, originalName: true, mime: true, bytes: true,
          note: true, uploadedAt: true,
          extractionStatus: true, extractionError: true,
          guestUserId: true,
          guestUser: { select: { name: true } },
        },
      },
    },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json({ project });
};

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await own(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.homeTitle !== undefined) data.homeTitle = body.homeTitle?.slice(0, 20) ?? null;
  if (body.description !== undefined) data.description = body.description;
  if (body.extractionPrompt !== undefined) data.extractionPrompt = body.extractionPrompt;
  if (body.studnaStandardPrompt !== undefined) {
    data.studnaStandardPrompt = body.studnaStandardPrompt?.trim() || null;
  }
  if (body.studnaBriefPrompt !== undefined) {
    data.studnaBriefPrompt = body.studnaBriefPrompt?.trim() || null;
  }
  if (body.projectSummaryPrompt !== undefined) {
    data.projectSummaryPrompt = body.projectSummaryPrompt?.trim() || null;
  }
  if (body.analysisModel !== undefined) data.analysisModel = body.analysisModel;
  if (body.includeInDigest !== undefined) data.includeInDigest = body.includeInDigest;
  if (body.archive !== undefined) {
    data.archivedAt = body.archive ? new Date() : null;
  }
  // Integrace SRO Manager (Petr 2026-07-06)
  if (body.webhookUrl !== undefined) data.webhookUrl = body.webhookUrl?.trim() || null;
  if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret?.trim() || null;
  if (body.externalClientRef !== undefined) data.externalClientRef = body.externalClientRef?.trim() || null;

  const project = await prisma.projectBox.update({ where: { id }, data });
  return Response.json({ project });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await own(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Smaž audio soubory ze všech recordings
  const recs = await prisma.projectRecording.findMany({
    where: { projectId: id },
    select: { audioPath: true },
  });
  for (const r of recs) await deleteUpload(r.audioPath);

  // Smaž admin přílohy (PDF/XLS/...) z disku
  const files = await prisma.projectFile.findMany({
    where: { projectId: id },
    select: { storagePath: true },
  });
  for (const f of files) await deleteUpload(f.storagePath);

  await prisma.projectBox.delete({ where: { id } });
  return Response.json({ ok: true });
};
