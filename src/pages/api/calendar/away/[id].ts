import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { updateGoogleEvent, deleteGoogleEvent } from "@/lib/google-calendar";

export const prerender = false;

const updateSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["FULL", "TRAVEL_WORKING"]),
  title: z.string().max(200).optional(),
});

/**
 * PATCH /api/calendar/away/:id
 *
 * Petr 2026-05-19: edit existující OOO události (Dovolená / Nomád) přímo
 * v Rašeliništi, bez nutnosti otvírat Google Calendar / Fantastical.
 *
 * `:id` je lokální CalendarEvent.id. Z něj zjistíme `externalId` (Google
 * event ID) a zavoláme update.
 */
export const PATCH: APIRoute = async ({ request, params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!event.externalId) {
    return Response.json({ error: "Event nemá externalId — nelze updatovat přes Google." }, { status: 400 });
  }
  if (!event.type || (event.type !== "OOO_FULL" && event.type !== "OOO_TRAVEL_WORKING")) {
    return Response.json({ error: "Endpoint je jen pro OOO události (Dovolená/Nomád)." }, { status: 400 });
  }

  const { fromDate, toDate, mode, title } = parsed.data;
  const startsAt = new Date(`${fromDate}T00:00:00`);
  const endsAtExclusive = new Date(`${toDate}T00:00:00`);
  endsAtExclusive.setDate(endsAtExclusive.getDate() + 1);
  if (endsAtExclusive <= startsAt) {
    return Response.json({ error: "Konec musí být po začátku." }, { status: 400 });
  }

  const summary =
    mode === "FULL"
      ? `🌴 ${title ?? "Dovolená"}`
      : `💻 NOMÁD: ${title ?? "Pracuji odjinud"}`;

  try {
    const googleResult = await updateGoogleEvent(session.uid, event.externalId, {
      summary,
      startsAt,
      endsAt: endsAtExclusive,
      allDay: true,
    });

    // Sanity check — pokud Google vrátil JINÉ datum než jsme poslali,
    // něco je špatně. Často outOfOffice eventType odmítá změnu (Google
    // si drží původní). Ukážeme Petrovi diff.
    const sentStartDate = startsAt.toISOString().slice(0, 10);
    const sentEndDate = endsAtExclusive.toISOString().slice(0, 10);
    const gotStartDate = googleResult.start?.date ?? null;
    const gotEndDate = googleResult.end?.date ?? null;
    const dateMatches = gotStartDate === sentStartDate && gotEndDate === sentEndDate;

    // Local mirror update — sync à 5 min by to taky zachytil, ale rovnou
    // ať Petr v UI vidí změnu hned.
    await prisma.calendarEvent.update({
      where: { id },
      data: {
        title: summary,
        startsAt,
        endsAt: endsAtExclusive,
        type: mode === "FULL" ? "OOO_FULL" : "OOO_TRAVEL_WORKING",
      },
    });

    return Response.json({
      ok: true,
      google: {
        eventId: googleResult.id,
        updatedAt: googleResult.updated,
        start: googleResult.start,
        end: googleResult.end,
        summary: googleResult.summary,
        dateMatches,
        warning: !dateMatches
          ? `Google vrátil jiné datum než jsme poslali (sent ${sentStartDate}–${sentEndDate}, got ${gotStartDate}–${gotEndDate}). Změna možná neprošla — zkontroluj v Google Calendar.`
          : null,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

/**
 * DELETE /api/calendar/away/:id
 * Smaže OOO event z Google + označí v DB jako deletedRemotely.
 */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!event.externalId) {
    return Response.json({ error: "Event nemá externalId — nelze smazat přes Google." }, { status: 400 });
  }

  try {
    await deleteGoogleEvent(session.uid, event.externalId);
    await prisma.calendarEvent.update({
      where: { id },
      data: { deletedRemotely: true },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
