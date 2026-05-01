import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  title: z.string().min(1).max(200),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(60).nullable().optional(),
  reminderChannels: z.array(z.enum(["email", "whatsapp"])).optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const items = await prisma.anniversary.findMany({
    where: { userId: session.uid },
    orderBy: [{ month: "asc" }, { day: "asc" }],
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
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  const item = await prisma.anniversary.create({
    data: {
      userId: session.uid,
      title: body.title,
      month: body.month,
      day: body.day,
      year: body.year ?? null,
      note: body.note ?? null,
      reminderDaysBefore: body.reminderDaysBefore ?? null,
      reminderChannels: body.reminderChannels ?? [],
    },
  });

  return Response.json({ item });
};
