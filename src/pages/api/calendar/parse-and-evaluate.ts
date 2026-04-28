import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseEventText } from "@/lib/event-parser";
import { evaluateSlot } from "@/lib/rules";

export const prerender = false;

/**
 * POST /api/calendar/parse-and-evaluate
 * Body: { freeText: string }
 *
 * Vrátí strukturovaný parsing + verdict + okolní eventy daný den
 * pro mini-timeline v /quickadd.
 */
const schema = z.object({
  freeText: z.string().min(1).max(500),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const result = await parseEventText(parsed.data.freeText);
  if (!result.parsed) {
    return Response.json({
      parsed: null,
      needsClarification: result.needsClarification,
      evaluation: null,
      surroundingEvents: [],
    });
  }

  const startsAt = new Date(result.parsed.startsAt);
  const endsAt = new Date(result.parsed.endsAt);

  // Vyhodnoť slot pravidlovým enginem
  const evaluation = await evaluateSlot({
    type: result.parsed.type,
    startsAt,
    endsAt,
    locationName: result.parsed.locationName,
  });

  // Okolní eventy v daný den (pro mini-timeline)
  const dayStart = new Date(startsAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startsAt);
  dayEnd.setHours(23, 59, 59, 999);

  const surroundingEvents = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      AND: [{ endsAt: { gte: dayStart } }, { startsAt: { lte: dayEnd } }],
    },
    select: {
      id: true, title: true, type: true, source: true,
      startsAt: true, endsAt: true, locationText: true, allDay: true,
    },
    orderBy: { startsAt: "asc" },
  });

  return Response.json({
    parsed: result.parsed,
    needsClarification: result.needsClarification,
    evaluation,
    surroundingEvents,
  });
};
