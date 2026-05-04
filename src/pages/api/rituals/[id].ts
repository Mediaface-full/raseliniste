import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const PatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(8000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(0).max(7).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  startMinute: z.number().int().min(0).max(59).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  active: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await prisma.customRitual.findFirst({
    where: { id, userId: session.uid },
  });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title.trim();
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.daysOfWeek !== undefined) data.daysOfWeek = [...new Set(body.daysOfWeek)].sort();
  if (body.startHour !== undefined) data.startHour = body.startHour;
  if (body.startMinute !== undefined) data.startMinute = body.startMinute;
  if (body.durationMin !== undefined) data.durationMin = body.durationMin;
  if (body.active !== undefined) data.active = body.active;

  const updated = await prisma.customRitual.update({ where: { id }, data });
  return Response.json({ ritual: updated });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const result = await prisma.customRitual.deleteMany({
    where: { id, userId: session.uid },
  });
  if (result.count === 0) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json({ ok: true });
};
