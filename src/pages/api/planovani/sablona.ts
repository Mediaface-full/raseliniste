import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { invalidateWeekTemplateCache } from "@/lib/week-template";

export const prerender = false;

const Body = z.object({
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    mode: z.enum(["manager", "maker", "own", "off"]),
    label: z.string().max(60).nullable().optional(),
  })).length(7),
});

/** GET /api/planovani/sablona — aktuální šablona týdne */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const rows = await prisma.planningDayTemplate.findMany({
    where: { userId: session.uid },
    orderBy: { weekday: "asc" },
    select: { weekday: true, mode: true, label: true },
  });
  return Response.json({ days: rows });
};

/** PUT /api/planovani/sablona — uloží celou šablonu (7 dní) */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  await prisma.$transaction(
    parsed.data.days.map((d) =>
      prisma.planningDayTemplate.upsert({
        where: { userId_weekday: { userId: session.uid, weekday: d.weekday } },
        create: { userId: session.uid, weekday: d.weekday, mode: d.mode, label: d.label?.trim() || null },
        update: { mode: d.mode, label: d.label?.trim() || null },
      }),
    ),
  );
  invalidateWeekTemplateCache();
  return Response.json({ ok: true });
};
