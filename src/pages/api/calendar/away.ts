import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { createGoogleEvent } from "@/lib/google-calendar";

export const prerender = false;

const createSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["FULL", "TRAVEL_WORKING"]),
  title: z.string().max(200).optional(),
});

/**
 * POST /api/calendar/away
 * Vytvoří v Google Calendar all-day OOO event(y).
 * - mode=FULL → eventType=outOfOffice → typ OOO_FULL (vyblokuje vše vč. online)
 * - mode=TRAVEL_WORKING → běžný event s prefixem "🌴 NOMÁD: …" → typ OOO_TRAVEL_WORKING
 *   (vyblokuje jen prezenční sloty, online OK)
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const { fromDate, toDate, mode, title } = parsed.data;
  const startsAt = new Date(`${fromDate}T00:00:00`);
  const endsAtExclusive = new Date(`${toDate}T00:00:00`);
  endsAtExclusive.setDate(endsAtExclusive.getDate() + 1); // Google all-day end = exclusive

  if (endsAtExclusive <= startsAt) {
    return Response.json({ error: "Konec musí být po začátku." }, { status: 400 });
  }

  const summary =
    mode === "FULL"
      ? `🌴 ${title ?? "Dovolená"}`
      : `💻 NOMÁD: ${title ?? "Pracuji odjinud"}`;

  try {
    // POZNÁMKA: outOfOffice flag NEpoužíváme — Google API totiž odmítá
    // kombinaci eventType=outOfOffice + all-day. Workaround na timed event
    // 00:00-24:00 v Praha TZ vedl k vizuálně rozbitému zobrazení v
    // Fantasticalu (gigantický modrý blok přes 24 hodin místo all-day badge).
    // Petr má v Rašeliništi vlastní rules engine pro auto-decline pozvánek
    // přes verdict GREEN/YELLOW/RED — Google native OOO nepotřebuje.
    // Klasifikátor v Rašeliništi rozezná OOO podle prefixu 🌴 / 💻 NOMÁD.
    const result = await createGoogleEvent(session.uid, {
      summary,
      startsAt,
      endsAt: endsAtExclusive,
      allDay: true,
    });
    return Response.json({ ok: true, eventId: result.eventId, htmlLink: result.htmlLink });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

/**
 * GET /api/calendar/away — list aktivních a budoucích OOO období
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const events = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      type: { in: ["OOO_FULL", "OOO_TRAVEL_WORKING"] },
      endsAt: { gte: now },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true, externalId: true, title: true, type: true,
      startsAt: true, endsAt: true, source: true, sourceUrl: true,
    },
  });

  return Response.json({ events });
};
