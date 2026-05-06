import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const PatchBody = z.object({
  canRecordBrief: z.boolean().optional(),
  keepAudio: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  const guestId = params.guestId;
  if (!projectId || !guestId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  // Ownership check projektu
  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.canRecordBrief !== undefined) data.canRecordBrief = body.canRecordBrief;
  if (body.keepAudio !== undefined) data.keepAudio = body.keepAudio;

  const invitation = await prisma.projectInvitation.update({
    where: { projectId_guestUserId: { projectId, guestUserId: guestId } },
    data,
  });
  return Response.json({ invitation });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  const guestId = params.guestId;
  if (!projectId || !guestId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.projectInvitation.delete({
    where: { projectId_guestUserId: { projectId, guestUserId: guestId } },
  });

  return Response.json({ ok: true });
};
