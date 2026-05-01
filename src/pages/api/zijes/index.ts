import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

// HH:MM nebo prázdné. Strict regex aby AI/uživatel neposlal blbost.
const timeOrEmpty = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional();

const Body = z.object({
  type: z.enum(["lunch", "evening"]),
  lastMealAt: timeOrEmpty,
  lastWaterAt: timeOrEmpty,
  bodyFeeling: z.string().max(500).nullable().optional(),
  mood: z.number().int().min(1).max(10).nullable().optional(),
  whatWorked: z.string().max(500).nullable().optional(),
  contacts: z.string().max(500).nullable().optional(),
  oldPattern: z.string().max(500).nullable().optional(),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const limitStr = url.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? "60", 10) || 60));

  const items = await prisma.checkIn.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    take: limit,
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

  const item = await prisma.checkIn.create({
    data: {
      userId: session.uid,
      type: body.type,
      lastMealAt: body.lastMealAt ?? null,
      lastWaterAt: body.lastWaterAt ?? null,
      bodyFeeling: body.bodyFeeling?.trim() || null,
      mood: body.mood ?? null,
      whatWorked: body.whatWorked?.trim() || null,
      contacts: body.contacts?.trim() || null,
      oldPattern: body.oldPattern?.trim() || null,
    },
  });

  return Response.json({ item });
};
