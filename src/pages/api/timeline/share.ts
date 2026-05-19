import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  projectId: z.string().min(1).max(100),
  expiryDays: z.number().int().min(1).max(365).default(30),
});

/**
 * POST /api/timeline/share
 *   Create public read-only share link.
 *   Body: { projectId, expiryDays }
 *   Returns: { token, url }
 *
 * Petr 2026-05-19 — F4. Token = random 22 chars (base64url).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  // Ověř že projekt existuje a patří uživateli
  const project = await prisma.todoistProjectMirror.findFirst({
    where: { userId: session.uid, todoistId: parsed.data.projectId },
    select: { name: true, todoistId: true },
  });
  if (!project) return Response.json({ error: "Projekt nenalezen." }, { status: 404 });

  const token = randomBytes(16).toString("base64url");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.expiryDays);

  await prisma.sharedTimeline.create({
    data: {
      userId: session.uid,
      projectId: project.todoistId,
      projectName: project.name,
      token,
      expiresAt,
    },
  });

  return Response.json({ token, expiresAt: expiresAt.toISOString() });
};

/**
 * GET /api/timeline/share — list aktivních share links pro Petra (admin přehled).
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const shares = await prisma.sharedTimeline.findMany({
    where: { userId: session.uid, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, projectId: true, projectName: true, token: true, expiresAt: true, createdAt: true },
  });

  return Response.json({ shares });
};

/**
 * DELETE /api/timeline/share?id=xxx — revoke share link.
 */
export const DELETE: APIRoute = async ({ url, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const share = await prisma.sharedTimeline.findUnique({ where: { id } });
  if (!share || share.userId !== session.uid) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.sharedTimeline.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return Response.json({ ok: true });
};
