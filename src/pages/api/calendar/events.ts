import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { createGoogleEvent } from "@/lib/google-calendar";
import { evaluateSlot } from "@/lib/rules";
import { classifyEvent, type EventTypeStr } from "@/lib/event-classifier";

export const prerender = false;

/**
 * GET /api/calendar/events?from=...&to=...
 * Vrátí všechny CalendarEvent v daném okně.
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

  const rawEvents = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      AND: [{ endsAt: { gte: fromDate } }, { startsAt: { lte: toDate } }],
    },
    include: {
      location: { select: { name: true, isLocal: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  });

  // Dedup: stejný (source, title, startsAt, endsAt) = duplikát.
  // Hack ve view, root cause (recurring expansion / duplicit sync) je
  // vyřešitelný v sync logice — tohle drží UI čisté. Stejný pattern jako
  // /day/[date].astro (commit 08ab4f9).
  const seen = new Set<string>();
  const events = rawEvents.filter((e) => {
    const key = `${e.source}|${e.title}|${e.startsAt.getTime()}|${e.endsAt.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Response.json({
    events,
    dedupedCount: rawEvents.length - events.length,
  });
};

/**
 * POST /api/calendar/events
 * Body: { title, type, startsAt, endsAt, locationName?, description?, manualOverride? }
 *
 * Vytvoří event v Google Calendar (primary) a uloží do DB.
 * - Verdict RED bez manualOverride → 409 Conflict.
 * - manualOverride + verdict ≠ GREEN → uloží + zaloguje RuleViolation.
 */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum([
    "MEETING_PRAGUE", "MEETING_HOME", "MEETING_ELSEWHERE", "MEETING_ONLINE",
    "PERSONAL", "OTHER",
  ]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  locationName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  manualOverride: z.boolean().optional(),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const type = input.type as EventTypeStr;

  // Re-evaluate na serveru — UI verdiktu nedůvěřujeme
  const evaluation = await evaluateSlot({
    type,
    startsAt,
    endsAt,
    locationName: input.locationName ?? null,
  });

  if (evaluation.verdict === "RED" && !input.manualOverride) {
    return Response.json(
      { error: "VERDICT_RED", evaluation },
      { status: 409 },
    );
  }

  // Vytvoř v Google
  const locationText = input.locationName === "online" ? null : input.locationName ?? null;
  const wantsMeet = type === "MEETING_ONLINE";

  let googleResult: { eventId: string; htmlLink: string | null; meetLink: string | null };
  try {
    googleResult = await createGoogleEvent(session.uid, {
      summary: input.title,
      description: input.description ?? undefined,
      location: locationText ?? undefined,
      startsAt,
      endsAt,
      conferenceData: wantsMeet,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const finalType = await classifyEvent({
    title: input.title,
    description: input.description ?? null,
    locationText,
    allDay: false,
    source: "GOOGLE_PRIMARY",
  });

  const created = await prisma.calendarEvent.create({
    data: {
      source: "GOOGLE_PRIMARY",
      externalId: googleResult.eventId,
      sourceUrl: googleResult.htmlLink,
      type: finalType as never,
      title: input.title,
      description: googleResult.meetLink
        ? `${input.description ?? ""}\n\nMeet: ${googleResult.meetLink}`.trim()
        : input.description ?? null,
      locationText,
      startsAt,
      endsAt,
      allDay: false,
      timezone: "Europe/Prague",
      manualOverride: input.manualOverride ?? false,
      lastSyncedAt: new Date(),
    },
  });

  if (input.manualOverride && evaluation.verdict !== "GREEN") {
    const dayStart = new Date(startsAt);
    dayStart.setHours(0, 0, 0, 0);
    for (const sig of evaluation.signals) {
      await prisma.ruleViolation.create({
        data: {
          forDate: dayStart,
          eventId: created.id,
          ruleName: sig.rule,
          severity: sig.severity,
          message: sig.message,
          acknowledged: true,
        },
      });
    }
  }

  return Response.json({
    event: created,
    evaluation,
    meetLink: googleResult.meetLink,
  });
};
