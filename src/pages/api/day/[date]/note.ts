import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/day/:date/note  — create DayNote
 * Body: { text, area? }
 */
const schema = z.object({
  text: z.string().min(1).max(500),
  area: z.string().max(100).nullable().optional(),
});

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const dateStr = params.date as string | undefined;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return Response.json({ error: "Invalid date format" }, { status: 400 });
  }
  const forDate = new Date(`${dateStr}T00:00:00`);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const note = await prisma.dayNote.create({
    data: {
      forDate,
      text: parsed.data.text,
      area: parsed.data.area ?? null,
    },
  });

  return Response.json({ note });
};
