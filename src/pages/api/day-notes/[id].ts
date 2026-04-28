import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * PATCH  /api/day-notes/:id  — toggle done, edit text/area
 * DELETE /api/day-notes/:id
 */
const patchSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  area: z.string().max(100).nullable().optional(),
  done: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.text !== undefined) data.text = parsed.data.text;
  if (parsed.data.area !== undefined) data.area = parsed.data.area;
  if (parsed.data.done !== undefined) {
    data.done = parsed.data.done;
    data.doneAt = parsed.data.done ? new Date() : null;
  }

  try {
    const note = await prisma.dayNote.update({ where: { id }, data });
    return Response.json({ note });
  } catch {
    return Response.json({ error: "DayNote nenalezen" }, { status: 404 });
  }
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  try {
    await prisma.dayNote.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "DayNote nenalezen" }, { status: 404 });
  }
};
