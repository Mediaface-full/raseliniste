import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/calendar/events?from=...&to=...
 * Vrátí všechny CalendarEvent v daném okně, různě klasifikované podle source.
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return Response.json({ error: "Missing 'from' or 'to' query param (ISO date)" }, { status: 400 });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  const events = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      // Overlapping window
      AND: [{ endsAt: { gte: fromDate } }, { startsAt: { lte: toDate } }],
    },
    include: {
      location: { select: { name: true, isLocal: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  });

  return Response.json({ events });
};
