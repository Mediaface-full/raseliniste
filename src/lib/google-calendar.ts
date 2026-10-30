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

  // Sběrný Set IDs z aktuálního API response — pro sweep pass na konci.
  // Předtím jsme se spoléhali jen na cancelled status z showDeleted=true,
  // ale Google občas nevrátí cancelled instance recurring eventu, pokud
  // byly smazány už dříve a paging window posunut. Sweep zaručí: co dnes
  // v Google API není, není v Rašeliništi (s safety guards proti error).
  const seenIds = new Set<string>();

  // Gideon 2026-08-13: rituály propsané do Googlu (CustomRitual.googleEventId)
  // se NESMÍ syncovat zpátky — v Rašeliništi se kreslí jako virtual events,
  // jinak by byly vidět dvakrát. Instance recurring eventu nesou recurringEventId.
  const ritualRows = await prisma.customRitual.findMany({
    where: { googleEventId: { not: null } },
    select: { googleEventId: true },
  });
  const ritualGoogleIds = new Set(ritualRows.map((r) => r.googleEventId as string));

  let pageToken: string | undefined = undefined;
  let pagingComplete = false;
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
        if (ev.id) seenIds.add(ev.id);
        // Instance rituálového recurring eventu → přeskočit (viz výše)
        if ((ev.recurringEventId && ritualGoogleIds.has(ev.recurringEventId)) || (ev.id && ritualGoogleIds.has(ev.id))) {
          continue;
        }
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
    pagingComplete = true;

    await recordUsage(userId);
  } catch (e) {
    await recordError(userId, e);
    throw e;
  }

  // SWEEP: označ rows v window které nejsou v seenIds jako deleted.
  // Petr 2026-05-27 #13: dříve strict guard `errors === 0` znamenal že JEDNA
  // upsert chyba (např. invalid date u single event) zablokovala mazání
  // všech ostatních cancelled events. Petr nahlásil že smazaná událost
  // „kurz coaching" zůstávala v Rašeliništi i po sync.
  //
  // Nový guard: tolerujeme error rate < 10 %, pokud paging dokončil a máme
  // alespoň 20 events v window. Sweep tedy projde i když pár jednotlivých
  // events selhalo na upsertu — ty nejsou v seenIds (skipnuté), ale to je OK,
  // sweep je nezmění protože jsou už v DB.
  const errorRate = seenIds.size > 0 ? errors / seenIds.size : 1;
  const sweepSafe = pagingComplete && seenIds.size >= 20 && errorRate < 0.1;
  if (sweepSafe) {
    const sweepResult = await prisma.calendarEvent.updateMany({
      where: {
        source: "GOOGLE_PRIMARY",
        deletedRemotely: false,
        externalId: { notIn: Array.from(seenIds) },
        // Jen v aktuálním sync window — historicky starší necháme být
        startsAt: { gte: timeMin, lte: timeMax },
      },
      data: { deletedRemotely: true, lastSyncedAt: new Date() },
    });
    if (sweepResult.count > 0) {
      console.log(
        `[google-calendar] sweep marked ${sweepResult.count} events as deletedRemotely ` +
        `(seen=${seenIds.size}, errors=${errors}, errorRate=${(errorRate * 100).toFixed(1)}%)`,
      );
    }
    deleted += sweepResult.count;
  } else if (pagingComplete) {
    console.warn(
      `[google-calendar] sweep SKIPPED — seen=${seenIds.size} (need >=20), ` +
      `errors=${errors}, errorRate=${(errorRate * 100).toFixed(1)}% (need <10%). ` +
      `Smazané eventy v Google zůstanou v DB do dalšího sync.`,
    );
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

  const existing = await prisma.calendarEvent.findUnique({
    where: { source_externalId: { source: "GOOGLE_PRIMARY", externalId: ev.id } },
    select: { id: true, etag: true },
  });
  // Pokud etag se nezměnil, jen touch lastSyncedAt — PŘED klasifikací, ať se
  // nevolá AI pro nezměněnou událost při každém 5min syncu.
  if (existing?.etag && existing.etag === ev.etag) {
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: { lastSyncedAt: new Date() },
    });
    return "skipped";
  }

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

  if (!existing) {
    // Dědičnost blocksBooking pro nové výskyty opakované série (viz
    // calendar-series.ts; Gideon 2026-08-04)
    const { inheritSeriesBlocksBooking } = await import("./calendar-series");
    const inherited = await inheritSeriesBlocksBooking("GOOGLE_PRIMARY", ev.id);
    const created = await prisma.calendarEvent.create({
      data: inherited === null ? data : { ...data, blocksBooking: inherited },
    });
    void extractPrepInBackground(created.id, title, description);
    return "inserted";
  }
  await prisma.calendarEvent.update({ where: { id: existing.id }, data });
  // Etag se změnil = description možná také → re-extract prep
  void extractPrepInBackground(existing.id, title, description);
  return "updated";
}

/**
 * Fire-and-forget extrakce prep z popisu události. Nevolá se synchronně,
 * aby sync cyklus nestrávil 0.5s na každé události. Při chybě jen loguje.
 */
async function extractPrepInBackground(eventId: string, title: string, description: string | null): Promise<void> {
  if (!description || !description.trim()) {
    // Description prázdný — vyčisti případné staré prep (Petr smazal popis)
    try {
      await prisma.calendarEvent.update({
        where: { id: eventId },
        data: { prepNote: null, itemsToBring: [] },
      });
    } catch { /* ignore */ }
    return;
  }
  try {
    const { extractCalendarPrep } = await import("./calendar-prep-ai");
    const prep = await extractCalendarPrep({ title, description });
    await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { prepNote: prep.prepNote, itemsToBring: prep.itemsToBring },
    });
  } catch (e) {
    console.warn(`[google-calendar prep ${eventId}]`, e instanceof Error ? e.message : String(e));
  }
}

function parseEventDate(d: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!d) return null;
  if (d.dateTime) return new Date(d.dateTime);
  if (d.date) {
    // d.date je YYYY-MM-DD (kalendářní datum bez TZ). Uložíme deterministicky
    // jako UTC midnight, ať server TZ neovlivní konzistenci napříč deploys.
    // Bez tohoto: `new Date("2026-05-09T00:00:00")` parsuje server-local TZ
    // (UTC docker → 00:00 UTC, Praha → 22:00 UTC předchozí den) → bug s
    // multi-day spans v týdenním pohledu.
    const [y, m, day] = d.date.split("-").map((s) => parseInt(s, 10));
    return new Date(Date.UTC(y, m - 1, day));
  }
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
  // Petr 2026-05-27 #21: custom popup reminders (X min před). Pro booking
  // prezenčních schůzek dává smysl 60 min (Apple Maps Time to Leave si
  // ETA spočítá sám pokud má location adresu, tohle je pojistka). Pro
  // online schůzky 10 min předem.
  reminderMinutes?: number[];
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

  // POZOR: Google Calendar API odmítá `eventType=outOfOffice` v kombinaci
  // s all-day eventy ("An out of office event must not be an all-day event").
  // Pokud volající chce OOO + all-day range, převedeme na full-day TIMED
  // event v Praha TZ (00:00 → další den 00:00 exclusive).
  const useAllDay = input.allDay && !input.outOfOffice;

  if (useAllDay) {
    // Google all-day: date YYYY-MM-DD, end exclusive (= startDate + 1 den pro single-day)
    requestBody.start = { date: input.startsAt.toISOString().slice(0, 10) };
    requestBody.end = { date: input.endsAt.toISOString().slice(0, 10) };
  } else {
    // Pro OOO + allDay vyrobíme timed event 00:00–24:00 Praha TZ podle range.
    // Petr volá s startsAt = first day 00:00 UTC, endsAt = lastDay+1 00:00 UTC
    // (exclusive). Pro OOO Google chce dateTime + timeZone.
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

  // Petr 2026-05-27 #21: explicit popup reminders. Override useDefault aby
  // se Apple/Google Calendar appce zobrazilo upozornění X min předem
  // i pokud Petr nemá nastavené Default Alerts. Pro Time to Leave (ETA)
  // potřebuje event location adresu, tohle je pojistka.
  if (input.reminderMinutes && input.reminderMinutes.length > 0) {
    requestBody.reminders = {
      useDefault: false,
      overrides: input.reminderMinutes.map((minutes) => ({
        method: "popup" as const,
        minutes,
      })),
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

// ---------------------------------------------------------------------------
// Rituály → opakované Google eventy (Gideon 2026-08-13)
// ---------------------------------------------------------------------------

/** RRULE BYDAY kódy — index odpovídá CustomRitual.daysOfWeek (0=Po … 6=Ne). */
const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export interface RitualRecurringInput {
  title: string;
  description: string | null;
  daysOfWeek: number[];        // 0=Po … 6=Ne, neprázdné
  startHour: number;           // Praha TZ
  startMinute: number;
  durationMin: number;
  reminderMinutes: number | null; // null = žádné upozornění
  googleEventId: string | null;   // existující recurring event → patch
}

/** Datum (Y/M/D v Praze) nejbližšího dne, jehož den v týdnu (0=Po) je v daysOfWeek. */
function nextPragueOccurrence(daysOfWeek: number[]): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
  for (let i = 0; i < 7; i++) {
    const cand = new Date(Date.now() + i * 86400000);
    const [y, m, d] = fmt.format(cand).split("-").map(Number);
    const dowMon0 = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
    if (daysOfWeek.includes(dowMon0)) return { y, m, d };
  }
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return { y, m, d }; // nedosažitelné (daysOfWeek neprázdné), fallback dnes
}

/**
 * Vytvoří / aktualizuje opakovaný Google event pro rituál (RRULE WEEKLY).
 * Časy posíláme jako naive local string + timeZone Europe/Prague — Google pak
 * drží opakování přes DST správně. Vrací eventId (nový při 404/410 na patchi).
 */
export async function upsertRitualRecurringEvent(userId: string, r: RitualRecurringInput): Promise<string> {
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const { y, m, d } = nextPragueOccurrence(r.daysOfWeek);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startLocal = `${y}-${pad(m)}-${pad(d)}T${pad(r.startHour)}:${pad(r.startMinute)}:00`;
  const endTotal = r.startHour * 60 + r.startMinute + r.durationMin;
  // durationMin max 480 → konec nikdy nepřeteče přes půlnoc jen u startů po 16:00+8h;
  // pro jistotu clamp na 23:59 (Google vyžaduje end tentýž den u naive stringu)
  const endMin = Math.min(endTotal, 23 * 60 + 59);
  const endLocal = `${y}-${pad(m)}-${pad(d)}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`;
  const byday = [...new Set(r.daysOfWeek)].sort().map((i) => RRULE_DAYS[i]).join(",");

  const requestBody: calendar_v3.Schema$Event = {
    summary: r.title,
    description: r.description ?? undefined,
    start: { dateTime: startLocal, timeZone: "Europe/Prague" },
    end: { dateTime: endLocal, timeZone: "Europe/Prague" },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${byday}`],
    reminders: {
      useDefault: false,
      overrides: r.reminderMinutes != null ? [{ method: "popup", minutes: r.reminderMinutes }] : [],
    },
  };

  if (r.googleEventId) {
    try {
      const res = await calendar.events.patch({ calendarId: "primary", eventId: r.googleEventId, requestBody });
      await recordUsage(userId);
      return res.data.id ?? r.googleEventId;
    } catch (e) {
      const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code;
      if (status !== 404 && status !== 410) throw e;
      // event v Googlu zmizel (ručně smazán) → založ nový
    }
  }
  const res = await calendar.events.insert({ calendarId: "primary", requestBody });
  await recordUsage(userId);
  if (!res.data.id) throw new Error("Google nevrátil id eventu.");
  return res.data.id;
}

/** Smaže recurring event rituálu; 404/410 (už neexistuje) ignoruje. */
export async function deleteRitualRecurringEvent(userId: string, googleEventId: string): Promise<void> {
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId: googleEventId });
    await recordUsage(userId);
  } catch (e) {
    const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code;
    if (status !== 404 && status !== 410) throw e;
  }
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

/**
 * Update existující Google Calendar event. Pro OOO (Dovolená/Nomád) — Petr
 * 2026-05-19 — chce editovat datum/název přímo v Rašeliništi.
 *
 * Pošle patch (jen vyplněná pole). Pro all-day range respektuje stejný
 * pattern jako createGoogleEvent (date YYYY-MM-DD, end exclusive).
 */
export async function updateGoogleEvent(
  userId: string,
  eventId: string,
  input: {
    summary?: string;
    startsAt?: Date;
    endsAt?: Date;
    allDay?: boolean;
  },
): Promise<{ id: string; updated: string | null; start: any; end: any; summary: string | null }> {
  const auth = await getAuthorizedClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  // Petr 2026-05-20: PATCH s `start.date` nestačil — Google ignoroval změnu
  // i s `dateTime: null` hackem. Pro all-day eventy (typicky OOO Dovolená/Nomád)
  // jdeme cestou DELETE + CREATE. Spolehlivé, vždy funguje. Nový event má jiný
  // ID — caller musí update local mirror.externalId.
  if (input.allDay && input.startsAt && input.endsAt) {
    // 1. Načti původní event pro defaultní hodnoty (kdyby summary chyběl v input)
    let originalSummary = input.summary;
    if (originalSummary === undefined) {
      try {
        const orig = await calendar.events.get({ calendarId: "primary", eventId });
        originalSummary = orig.data.summary ?? "";
      } catch {
        originalSummary = "";
      }
    }

    // 2. DELETE starý
    try {
      await calendar.events.delete({ calendarId: "primary", eventId });
    } catch (e: any) {
      // 410 Gone = už smazaný, OK pokračovat
      if (e?.code !== 410 && e?.response?.status !== 410) throw e;
    }

    // 3. CREATE nový
    const created = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: originalSummary,
        start: { date: input.startsAt.toISOString().slice(0, 10) },
        end: { date: input.endsAt.toISOString().slice(0, 10) },
      },
    });

    await recordUsage(userId);

    console.log(`[google-calendar.update] DELETE+CREATE old=${eventId} new=${created.data.id} → start=${JSON.stringify(created.data.start)} end=${JSON.stringify(created.data.end)}`);

    return {
      id: created.data.id!,
      updated: created.data.updated ?? null,
      start: created.data.start,
      end: created.data.end,
      summary: created.data.summary ?? null,
    };
  }

  // Non-all-day events: zachovat původní PATCH cestu
  const requestBody: calendar_v3.Schema$Event = {};
  if (input.summary !== undefined) requestBody.summary = input.summary;
  if (input.startsAt && input.endsAt) {
    requestBody.start = { dateTime: input.startsAt.toISOString(), timeZone: "Europe/Prague" } as any;
    requestBody.end = { dateTime: input.endsAt.toISOString(), timeZone: "Europe/Prague" } as any;
  }

  const res = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody,
  });
  await recordUsage(userId);

  console.log(`[google-calendar.update] PATCH eventId=${eventId} → start=${JSON.stringify(res.data.start)} end=${JSON.stringify(res.data.end)} summary="${res.data.summary}"`);

  return {
    id: res.data.id ?? eventId,
    updated: res.data.updated ?? null,
    start: res.data.start,
    end: res.data.end,
    summary: res.data.summary ?? null,
  };
}
