import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/day/:date — events + dayNotes + briefingDigest pro daný den
 * date format: YYYY-MM-DD
 */
export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const dateStr = params.date as string | undefined;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return Response.json({ error: "Invalid date format, use YYYY-MM-DD" }, { status: 400 });
  }

  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);

  const [events, dayNotes, briefingDigest, ruleViolations] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        deletedRemotely: false,
        // `gt` (NE `gte`) — Google/iCal all-day má endsAt exclusive, takže
        // sobotní celodenka má endsAt = neděle 00:00 → `gte` by ji ukázal i v neděli
        AND: [{ endsAt: { gt: dayStart } }, { startsAt: { lte: dayEnd } }],
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.dayNote.findMany({
      where: { forDate: dayStart },
      orderBy: [{ done: "asc" }, { createdAt: "asc" }],
    }),
    prisma.briefingDigest.findUnique({ where: { forDate: dayStart } }),
    prisma.ruleViolation.findMany({
      where: { forDate: dayStart },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return Response.json({
    date: dateStr,
    events,
    dayNotes,
    briefingDigest,
    ruleViolations,
  });
};
