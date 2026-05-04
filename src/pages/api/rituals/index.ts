import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(8000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(0).max(7),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  durationMin: z.number().int().min(5).max(480),
  active: z.boolean().optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const items = await prisma.customRitual.findMany({
    where: { userId: session.uid },
    orderBy: [{ active: "desc" }, { startHour: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ items });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json(
      { error: "INVALID_INPUT", message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const created = await prisma.customRitual.create({
    data: {
      userId: session.uid,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      daysOfWeek: [...new Set(body.daysOfWeek)].sort(),
      startHour: body.startHour,
      startMinute: body.startMinute,
      durationMin: body.durationMin,
      active: body.active ?? true,
    },
  });
  return Response.json({ ritual: created });
};
