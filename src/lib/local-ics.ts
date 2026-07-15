// Lokální .ics kalendáře (Petr 2026-07-15)
//
// Gideon nahraje .ics soubor → události se uloží jako CalendarEvent se
// source=LOCAL_ICS a vazbou na LocalCalendar. Čistě informativní:
//  - žádný sync nikam (Google/iCloud joby filtrují podle svého source)
//  - booking je ignoruje (rules.ts vyřazuje LOCAL_ICS z busy overlapu)
//  - smazání kalendáře = CASCADE smaže jeho události
//
// Recurring expanze převzatá z icloud-calendar.ts (jump-forward iterator
// na začátek okna + safety limit — viz feedback_icloud_recurring_iterator.md).

import ICAL from "ical.js";
import { prisma } from "./db";

// Okno expanze: 1 rok zpět, 2 roky dopředu
const WINDOW_BACK_MS = 365 * 24 * 60 * 60 * 1000;
const WINDOW_FWD_MS = 730 * 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_CALENDAR = 5000;

export interface ImportResult {
  calendarId: string;
  name: string;
  eventCount: number;
  truncated: boolean;
}

interface ParsedOccurrence {
  externalId: string;
  title: string;
  description: string | null;
  locationText: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

function isAllDayEvent(event: ICAL.Event): boolean {
  return Boolean(event.startDate && (event.startDate as { isDate?: boolean }).isDate);
}

/** Rozparsuje ICS text a rozbalí recurring události v okně. Throwuje na nevalidní ICS. */
export function parseIcsEvents(icsText: string, calendarKey: string): { occurrences: ParsedOccurrence[]; truncated: boolean } {
  const parsed = ICAL.parse(icsText); // throwuje ParserError na nevalidní vstup
  const comp = new ICAL.Component(parsed);
  const vevents = comp.getAllSubcomponents("vevent");

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_BACK_MS);
  const windowEnd = new Date(now + WINDOW_FWD_MS);

  const occurrences: ParsedOccurrence[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const ve of vevents) {
    if (occurrences.length >= MAX_EVENTS_PER_CALENDAR) {
      truncated = true;
      break;
    }
    const event = new ICAL.Event(ve);
    if (!event.startDate) continue;
    const uid = event.uid ?? `nouid-${occurrences.length}`;
    const startsAtRaw = event.startDate.toJSDate();
    const endsAtRaw = event.endDate ? event.endDate.toJSDate() : startsAtRaw;
    const allDay = isAllDayEvent(event);
    const title = event.summary?.trim() || "(bez názvu)";
    const description = event.description?.trim() || null;
    const locationText = event.location?.trim() || null;

    const push = (occStart: Date, occEnd: Date, externalId: string) => {
      if (seen.has(externalId)) return; // duplicitní UID v souboru
      seen.add(externalId);
      occurrences.push({ externalId, title, description, locationText, startsAt: occStart, endsAt: occEnd, allDay });
    };

    if (event.isRecurring()) {
      // POZOR: jump-forward event.iterator(startTime) NEpoužívat — ICAL.js tím
      // nahradí DTSTART a occurrences dostanou čas okna místo času události
      // (ověřeno testem: porada 08:00 → 15:08). Upload je jednorázová operace,
      // takže iterujeme od DTSTART s vysokým safety limitem a pre-window
      // occurrences přeskakujeme (denní event 10 let starý ≈ 4000 iterací).
      const iter = event.iterator();
      const durationMs = endsAtRaw.getTime() - startsAtRaw.getTime();
      let next: ICAL.Time | null;
      let safety = 0;
      while ((next = iter.next()) && safety < 50000) {
        safety++;
        if (occurrences.length >= MAX_EVENTS_PER_CALENDAR) {
          truncated = true;
          break;
        }
        const occStart = next.toJSDate();
        if (occStart > windowEnd) break;
        const occEnd = new Date(occStart.getTime() + durationMs);
        if (occEnd < windowStart) continue;
        push(occStart, occEnd, `${calendarKey}_${uid}_${occStart.toISOString()}`);
      }
    } else {
      if (endsAtRaw < windowStart || startsAtRaw > windowEnd) continue;
      push(startsAtRaw, endsAtRaw, `${calendarKey}_${uid}`);
    }
  }

  return { occurrences, truncated };
}

/**
 * Import (nebo re-import = kompletní replace obsahu) .ics kalendáře.
 * Když je předané existingId, přepíše obsah existujícího kalendáře.
 */
export async function importIcsCalendar(input: {
  name: string;
  filename: string;
  icsText: string;
  existingId?: string;
}): Promise<ImportResult> {
  const name = input.name.trim() || input.filename;

  // Kalendář vytvořit/najít nejdřív — jeho id je součást externalId událostí
  let calendar;
  if (input.existingId) {
    calendar = await prisma.localCalendar.update({
      where: { id: input.existingId },
      data: { name, filename: input.filename },
    });
  } else {
    calendar = await prisma.localCalendar.create({
      data: { name, filename: input.filename },
    });
  }

  let parsedResult;
  try {
    parsedResult = parseIcsEvents(input.icsText, calendar.id);
  } catch (err) {
    // Nevalidní ICS: čerstvě vytvořený prázdný kalendář zase ukliď
    if (!input.existingId) {
      await prisma.localCalendar.delete({ where: { id: calendar.id } }).catch(() => {});
    }
    throw err;
  }
  const { occurrences, truncated } = parsedResult;

  const now = new Date();
  await prisma.$transaction([
    prisma.calendarEvent.deleteMany({ where: { localCalendarId: calendar.id } }),
    prisma.calendarEvent.createMany({
      data: occurrences.map((o) => ({
        source: "LOCAL_ICS" as const,
        externalId: o.externalId,
        type: "OTHER" as const,
        title: o.title,
        description: o.description,
        locationText: o.locationText,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        allDay: o.allDay,
        timezone: "Europe/Prague",
        localCalendarId: calendar.id,
        lastSyncedAt: now,
        deletedRemotely: false,
      })),
      skipDuplicates: true,
    }),
    prisma.localCalendar.update({
      where: { id: calendar.id },
      data: { eventCount: occurrences.length },
    }),
  ]);

  return { calendarId: calendar.id, name, eventCount: occurrences.length, truncated };
}
