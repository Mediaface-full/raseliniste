import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/diagnose/calendar-duplicates
 *
 * Najde duplicitní CalendarEvent záznamy v DB pro přihlášeného uživatele.
 * Skupinou je `(title, startsAt, endsAt)` — pokud jsou ≥2 záznamy se stejnou
 * trojicí, jsou to duplikáty (bez ohledu na source/externalId).
 *
 * Vrací detail co Petrovi pomůže zjistit ROOT CAUSE:
 *  - source (Google / iCloud Petr / iCloud syn / iCloud partnerka)
 *  - externalId (Google event ID nebo iCloud UID)
 *  - lastSyncedAt
 *  - sourceUrl (link zpět do kalendáře)
 *
 * Když dva mají stejný source → bug v sync logice (recurring rozbalený 2×,
 * nebo Google změnil ID a starý zůstal). Když mají různé source → Petr má
 * stejný event ve více kalendářích (shared event mezi Google + iCloud).
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Default: posledních 30 dní + dalších 90 (širší okno pro přehled)
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 86_400_000);
  const to = toParam ? new Date(toParam) : new Date(Date.now() + 90 * 86_400_000);

  const events = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      AND: [{ endsAt: { gte: from } }, { startsAt: { lte: to } }],
    },
    select: {
      id: true,
      source: true,
      externalId: true,
      sourceUrl: true,
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      lastSyncedAt: true,
      etag: true,
    },
    orderBy: { startsAt: "asc" },
  });

  // Skupiny podle (title, startsAt, endsAt)
  const groups = new Map<string, typeof events>();
  for (const e of events) {
    const key = `${e.title}|${e.startsAt.getTime()}|${e.endsAt.getTime()}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const duplicates = Array.from(groups.entries())
    .filter(([, arr]) => arr.length >= 2)
    .map(([key, arr]) => {
      const sources = new Set(arr.map((e) => e.source));
      const sameSource = sources.size === 1;
      return {
        key,
        count: arr.length,
        sameSource,
        rootCauseHint: sameSource
          ? "Stejný source → bug v sync logice (recurring expansion 2×, nebo Google změnil externalId a starý zůstal v DB)."
          : "Různé sources → event je v ≥2 kalendářích (např. shared mezi Google + iCloud).",
        records: arr.map((e) => ({
          id: e.id,
          source: e.source,
          externalId: e.externalId,
          sourceUrl: e.sourceUrl,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          allDay: e.allDay,
          lastSyncedAt: e.lastSyncedAt.toISOString(),
        })),
      };
    });

  // Přehledové počty
  const summary = {
    totalEvents: events.length,
    duplicateGroups: duplicates.length,
    duplicateRecords: duplicates.reduce((sum, g) => sum + g.count, 0),
    extraRecords: duplicates.reduce((sum, g) => sum + (g.count - 1), 0),
    sameSourceGroups: duplicates.filter((g) => g.sameSource).length,
    crossSourceGroups: duplicates.filter((g) => !g.sameSource).length,
    window: { from: from.toISOString(), to: to.toISOString() },
  };

  return Response.json({ summary, duplicates });
};
