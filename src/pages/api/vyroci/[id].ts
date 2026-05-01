import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(60).nullable().optional(),
  reminderChannels: z.array(z.enum(["email", "whatsapp"])).optional(),
});

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const own = await prisma.anniversary.findFirst({ where: { id, userId: session.uid } });
  if (!own) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const item = await prisma.anniversary.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.month !== undefined ? { month: body.month } : {}),
      ...(body.day !== undefined ? { day: body.day } : {}),
      ...(body.year !== undefined ? { year: body.year } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.reminderDaysBefore !== undefined ? { reminderDaysBefore: body.reminderDaysBefore } : {}),
      ...(body.reminderChannels !== undefined ? { reminderChannels: body.reminderChannels } : {}),
    },
  });
  return Response.json({ item });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const own = await prisma.anniversary.findFirst({ where: { id, userId: session.uid } });
  if (!own) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.anniversary.delete({ where: { id } });
  return Response.json({ ok: true });
};
