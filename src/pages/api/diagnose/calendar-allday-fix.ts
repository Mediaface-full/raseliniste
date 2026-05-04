import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/diagnose/calendar-allday-fix
 *
 * Najde all-day eventy, jejichž startsAt nebo endsAt NENÍ na UTC midnight
 * (např. uložené když server běžel v Praze TZ → 22:00 UTC místo 00:00 UTC).
 * To je hlavní příčina toho, že multi-day spans se v UI rozhodí.
 *
 * DRY RUN: vrátí seznam co by upravil. ?confirm=1 → skutečný update.
 *
 * Posun na nejbližší UTC midnight:
 *   2026-05-08 22:00 UTC (= 2026-05-09 00:00 PRAGUE) → 2026-05-09 00:00 UTC
 *   2026-05-09 02:00 UTC (= 2026-05-09 04:00 PRAGUE) → 2026-05-09 00:00 UTC
 * Tedy: zaokrouhlit na nejbližší midnight v Praha TZ a vyrobit z toho UTC.
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const confirm = url.searchParams.get("confirm") === "1";

  // Najdi všechny allDay eventy v DB
  const allDayEvents = await prisma.calendarEvent.findMany({
    where: { allDay: true, deletedRemotely: false },
    select: { id: true, title: true, source: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });

  type Plan = {
    id: string;
    title: string;
    source: string;
    oldStart: string;
    oldEnd: string;
    newStart: string;
    newEnd: string;
    pragueDayStart: string;
    pragueDayEnd: string;
  };

  const plan: Plan[] = [];

  for (const e of allDayEvents) {
    // Spočítej Praha kalendářní den pro start (kdy v Praze tento event začíná)
    const startDateKey = e.startsAt.toLocaleDateString("sv-SE", {
      timeZone: "Europe/Prague",
    });
    // Pro end (exclusive) vezmi den těsně před půlnocí v Praze
    // Odečteme 1 sekundu od endsAt a vezmeme Praha den
    const endProbe = new Date(e.endsAt.getTime() - 1000);
    const endDateKey = endProbe.toLocaleDateString("sv-SE", {
      timeZone: "Europe/Prague",
    });

    // Vyrobíme nové UTC midnight timestamps:
    //   newStart = startDateKey 00:00 UTC
    //   newEnd = (endDateKey + 1 den) 00:00 UTC (exclusive end)
    const [sy, sm, sd] = startDateKey.split("-").map((s) => parseInt(s, 10));
    const newStart = new Date(Date.UTC(sy, sm - 1, sd));
    const [ey, em, ed] = endDateKey.split("-").map((s) => parseInt(s, 10));
    const newEnd = new Date(Date.UTC(ey, em - 1, ed + 1));

    // Pokud už je vše na UTC midnight a den souhlasí, není co opravovat
    if (
      e.startsAt.getTime() === newStart.getTime() &&
      e.endsAt.getTime() === newEnd.getTime()
    ) {
      continue;
    }

    plan.push({
      id: e.id,
      title: e.title,
      source: e.source,
      oldStart: e.startsAt.toISOString(),
      oldEnd: e.endsAt.toISOString(),
      newStart: newStart.toISOString(),
      newEnd: newEnd.toISOString(),
      pragueDayStart: startDateKey,
      pragueDayEnd: endDateKey,
    });
  }

  if (!confirm) {
    return Response.json({
      ok: true,
      dryRun: true,
      message: `DRY RUN: ${plan.length} all-day eventů má posunutý timestamp od UTC midnight. Spusť s ?confirm=1 pro normalizaci.`,
      total: allDayEvents.length,
      toFix: plan.length,
      plan: plan.slice(0, 50), // limit pro response size
      truncated: plan.length > 50,
    });
  }

  // Skutečné updates
  let updated = 0;
  for (const p of plan) {
    await prisma.calendarEvent.update({
      where: { id: p.id },
      data: {
        startsAt: new Date(p.newStart),
        endsAt: new Date(p.newEnd),
      },
    });
    updated++;
  }

  return Response.json({
    ok: true,
    dryRun: false,
    updated,
    total: allDayEvents.length,
  });
};
