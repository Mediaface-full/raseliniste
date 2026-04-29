import { google, type calendar_v3 } from "googleapis";
import { prisma } from "./db";
import { getAuthorizedClient, recordError, recordUsage } from "./google-oauth";
import { classifyEvent, type EventTypeStr } from "./event-classifier";

/**
 * Google Calendar sync (read-write).
 *
 * Strategie: incremental sync přes `updatedMin`. Při prvním sync (nebo když
 * uplyne víc než 7 dní od posledního) plný sync na okno [now-7d, now+60d].
 * Recurring events expandujeme přes `singleEvents=true`, takže každá instance
 * má svůj externalId (`<eventId>_<instanceStart>`).
 */

const SYNC_WINDOW_PAST_DAYS = 7;
const SYNC_WINDOW_FUTURE_DAYS = 60;

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
  durationMs: number;
}

export async function syncGoogleCalendar(userId: string): Promise<SyncResult> {
  const start = Date.now();
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  // Najdi default Praha lokaci pro fallback
  const pragueLoc = await prisma.location.findUnique({ where: { name: "Praha" } });

  const now = new Date();
  const timeMin = new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let errors = 0;

  let pageToken: string | undefined = undefined;
  try {
    do {
      const res = await calendar.events.list({
        calendarId: "primary",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken,
      });
      const items: calendar_v3.Schema$Event[] = res.data.items ?? [];
      for (const ev of items) {
        try {
          const result = await upsertEvent(ev, pragueLoc?.id ?? null);
          if (result === "inserted") inserted++;
          else if (result === "updated") updated++;
          else if (result === "deleted") deleted++;
        } catch (e) {
          errors++;
          console.error("[google-calendar] upsert failed for", ev.id, e);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    await recordUsage(userId);
  } catch (e) {
    await recordError(userId, e);
    throw e;
  }

  return { inserted, updated, deleted, errors, durationMs: Date.now() - start };
}

type UpsertResult = "inserted" | "updated" | "deleted" | "skipped";

async function upsertEvent(
  ev: calendar_v3.Schema$Event,
  pragueLocId: string | null,
): Promise<UpsertResult> {
  if (!ev.id) return "skipped";

  // Cancellation — označit jako deletedRemotely, ne fyzicky smazat
  if (ev.status === "cancelled") {
    const existing = await prisma.calendarEvent.findUnique({
      where: { source_externalId: { source: "GOOGLE_PRIMARY", externalId: ev.id } },
    });
    if (!existing) return "skipped";
    if (existing.deletedRemotely) return "skipped";
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: { deletedRemotely: true, lastSyncedAt: new Date() },
    });
    return "deleted";
  }

  const startDate = parseEventDate(ev.start);
  const endDate = parseEventDate(ev.end);
  if (!startDate || !endDate) return "skipped";

  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const title = ev.summary ?? "(bez názvu)";
  const description = ev.description ?? null;
  const locationText = ev.location ?? null;

  // Klasifikace
  let type: EventTypeStr = "OTHER";
  if (ev.eventType === "outOfOffice") {
    type = "OOO_FULL";
  } else {
    type = await classifyEvent({
      title,
      description,
      locationText,
      allDay,
      source: "GOOGLE_PRIMARY",
    });
  }

  // Lokace — match na Location tabulku
  const locationId = await matchLocation(locationText) ?? (type === "MEETING_PRAGUE" ? pragueLocId : null);

  const data = {
    source: "GOOGLE_PRIMARY" as const,
    externalId: ev.id,
    sourceUrl: ev.htmlLink ?? null,
    type: type as never, // Prisma enum
    title,
    description,
    locationText,
    locationId,
    startsAt: startDate,
    endsAt: endDate,
    allDay,
    timezone: ev.start?.timeZone ?? "Europe/Prague",
    etag: ev.etag ?? null,
    deletedRemotely: false,
    lastSyncedAt: new Date(),
  };

  const existing = await prisma.calendarEvent.findUnique({
    where: { source_externalId: { source: "GOOGLE_PRIMARY", externalId: ev.id } },
    select: { id: true, etag: true },
  });

  if (!existing) {
    await prisma.calendarEvent.create({ data });
    return "inserted";
  }
  // Pokud etag se nezměnil, jen touch lastSyncedAt
  if (existing.etag && existing.etag === ev.etag) {
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: { lastSyncedAt: new Date() },
    });
    return "skipped";
  }
  await prisma.calendarEvent.update({ where: { id: existing.id }, data });
  return "updated";
}

function parseEventDate(d: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!d) return null;
  if (d.dateTime) return new Date(d.dateTime);
  if (d.date) return new Date(d.date + "T00:00:00");
  return null;
}

/**
 * Match location text na Location tabulku (name nebo aliases).
 * Vrací locationId nebo null.
 */
async function matchLocation(text: string | null): Promise<string | null> {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Načti jednou všechny lokace; pro pár desítek záznamů je to OK
  const locs = await prisma.location.findMany();
  for (const loc of locs) {
    if (loc.name.toLowerCase() === lower || lower.includes(loc.name.toLowerCase())) {
      return loc.id;
    }
    for (const alias of loc.aliases) {
      if (alias.toLowerCase() === lower || lower.includes(alias.toLowerCase())) {
        return loc.id;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CRUD pro write (volá se z /quickadd, bookingu)
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails?: string[];
  conferenceData?: boolean; // přidat Google Meet link
  allDay?: boolean;         // pro OOO události (celodenní range)
  outOfOffice?: boolean;    // Google native eventType=outOfOffice
}

export async function createGoogleEvent(
  userId: string,
  input: CreateEventInput,
): Promise<{ eventId: string; htmlLink: string | null; meetLink: string | null }> {
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const requestBody: calendar_v3.Schema$Event = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    attendees: input.attendeeEmails?.map((email) => ({ email })),
  };

  if (input.allDay) {
    // Google all-day: date YYYY-MM-DD, end exclusive (= startDate + 1 den pro single-day)
    requestBody.start = { date: input.startsAt.toISOString().slice(0, 10) };
    // endsAt by měl být DAY AFTER last day (Google konvence)
    requestBody.end = { date: input.endsAt.toISOString().slice(0, 10) };
  } else {
    requestBody.start = { dateTime: input.startsAt.toISOString(), timeZone: "Europe/Prague" };
    requestBody.end = { dateTime: input.endsAt.toISOString(), timeZone: "Europe/Prague" };
  }

  if (input.outOfOffice) {
    requestBody.eventType = "outOfOffice";
  }

  if (input.conferenceData) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: `rasel-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody,
    conferenceDataVersion: input.conferenceData ? 1 : 0,
    sendUpdates: input.attendeeEmails?.length ? "all" : "none",
  });

  await recordUsage(userId);

  const meetLink =
    res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;

  return {
    eventId: res.data.id!,
    htmlLink: res.data.htmlLink ?? null,
    meetLink,
  };
}

export async function deleteGoogleEvent(userId: string, eventId: string): Promise<void> {
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
  });
  await recordUsage(userId);
}
