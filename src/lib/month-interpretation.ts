/**
 * Interpretační lišta pro měsíční pohled — orientační, ne plánovací.
 * Faktické věty, žádné hodnocení.
 */

interface BasicEvent {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  title: string;
  source: string;
}

const CZ_MONTH_NAMES = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

/** Nominativ pro hlavičky ("Květen 2026"). Genitive výše pro fráze
 *  typu "4. května". */
export const CZ_MONTH_NAMES_NOM = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

export function interpretMonth(
  monthStart: Date, // první den v měsíci
  events: BasicEvent[],
): { lines: string[]; bigEvents: Array<{ title: string; date: string; source: string }> } {
  const lines: string[] = [];
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === monthStart.getFullYear() &&
    today.getMonth() === monthStart.getMonth();

  // 1. Kolik dní zbývá v měsíci
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  if (isCurrentMonth) {
    const daysLeft = monthEnd.getDate() - today.getDate() + 1;
    lines.push(`${daysLeft} ${formatDaysWord(daysLeft)} v tomto měsíci`);
  } else if (monthStart > today) {
    lines.push(`Před vámi celý měsíc (${monthEnd.getDate()} dní)`);
  }

  // 2. "Velké" eventy = celodenní + delší než 4 h
  const bigEvents = events
    .filter((e) => {
      if (e.allDay) return true;
      const dur = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 3_600_000;
      return dur >= 4;
    })
    .map((e) => ({
      title: e.title,
      date: new Date(e.startsAt).toISOString().slice(0, 10),
      source: e.source,
    }));

  if (bigEvents.length > 0 && bigEvents.length <= 5) {
    const labels = bigEvents.map((b) => {
      const d = new Date(b.date);
      return `${b.title} (${d.getDate()}. ${CZ_MONTH_NAMES[d.getMonth()]})`;
    });
    lines.push(`${bigEvents.length} ${formatBigEventsWord(bigEvents.length)}: ${labels.join(", ")}`);
  } else if (bigEvents.length > 5) {
    // Při větším počtu vypiš jen prvních 3-4 nejzajímavějších (allDay > 4h, atd.)
    const top = bigEvents.slice(0, 4);
    const labels = top.map((b) => {
      const d = new Date(b.date);
      return `${b.title.slice(0, 28)} (${d.getDate()}.${d.getMonth() + 1}.)`;
    });
    lines.push(
      `${bigEvents.length} velkých událostí, mj. ${labels.join(", ")} a další`,
    );
  }

  // 2b. Multi-day cesty (allDay s endsAt - startsAt > 1 den)
  const trips = events
    .filter((e) => {
      if (!e.allDay) return false;
      const days = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 86_400_000;
      return days >= 2 && days <= 14; // dovolená nebo cesta typicky 2-14 dní
    })
    .slice(0, 3);
  for (const t of trips) {
    const s = new Date(t.startsAt);
    const e = new Date(t.endsAt);
    e.setMilliseconds(e.getMilliseconds() - 1); // exclusive end → poslední den
    const sLabel = `${s.getDate()}.${s.getMonth() + 1}.`;
    const eLabel = `${e.getDate()}.${e.getMonth() + 1}.`;
    lines.push(`${t.title}: ${sLabel}–${eLabel}`);
  }

  // 3. Najdi nejhustší týden + nejvolnější týden v měsíci
  const perWeek = new Map<string, { count: number; weekStart: Date }>();
  for (const e of events) {
    const start = new Date(e.startsAt);
    const monday = mondayOf(start);
    const key = monday.toISOString().slice(0, 10);
    const existing = perWeek.get(key);
    if (existing) existing.count++;
    else perWeek.set(key, { count: 1, weekStart: monday });
  }
  const weeks = Array.from(perWeek.values()).sort((a, b) => b.count - a.count);
  if (weeks.length > 0 && weeks[0].count >= 5) {
    const ws = weeks[0].weekStart;
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    lines.push(
      `Nejhustší týden ${ws.getDate()}.–${we.getDate()}. ${CZ_MONTH_NAMES[we.getMonth()]} (${weeks[0].count} událostí)`,
    );
  }
  if (weeks.length > 1) {
    const lightest = weeks[weeks.length - 1];
    if (lightest.count <= 2 && weeks[0].count >= lightest.count + 3) {
      const ws = lightest.weekStart;
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      lines.push(
        `Volnější týden ${ws.getDate()}.–${we.getDate()}. ${CZ_MONTH_NAMES[we.getMonth()]}`,
      );
    }
  }

  // 4. Volné dny + víkendy
  const freeDays = countFreeDays(monthStart, monthEnd, events);
  if (freeDays > 0) {
    lines.push(`${freeDays} ${formatDaysWord(freeDays)} bez události v měsíci`);
  }

  const freeWeekends = countFreeWeekends(monthStart, monthEnd, events);
  if (freeWeekends === 0) {
    lines.push("Žádný víkend v měsíci úplně volný");
  } else if (freeWeekends === 1) {
    lines.push("Jeden volný víkend");
  } else {
    lines.push(`${freeWeekends} úplně volné víkendy`);
  }

  return { lines: lines.slice(0, 6), bigEvents };
}

function countFreeWeekends(start: Date, end: Date, events: BasicEvent[]): number {
  const eventDates = new Set(events.map((e) => new Date(e.startsAt).toISOString().slice(0, 10)));
  const cursor = new Date(start);
  let weekends = 0;
  while (cursor <= end) {
    const dow = cursor.getDay(); // 0=Ne, 6=So
    if (dow === 6) {
      const sat = cursor.toISOString().slice(0, 10);
      const sunDate = new Date(cursor);
      sunDate.setDate(sunDate.getDate() + 1);
      const sun = sunDate.toISOString().slice(0, 10);
      if (!eventDates.has(sat) && !eventDates.has(sun)) weekends++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return weekends;
}

function mondayOf(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  const dow = result.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  result.setDate(result.getDate() + offsetToMonday);
  return result;
}

function countFreeDays(start: Date, end: Date, events: BasicEvent[]): number {
  const eventDates = new Set(events.map((e) => new Date(e.startsAt).toISOString().slice(0, 10)));
  let free = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!eventDates.has(cursor.toISOString().slice(0, 10))) free++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return free;
}

function formatDaysWord(n: number): string {
  if (n === 1) return "den";
  if (n >= 2 && n <= 4) return "dny";
  return "dní";
}

function formatBigEventsWord(n: number): string {
  if (n === 1) return "velká událost";
  if (n >= 2 && n <= 4) return "velké události";
  return "velkých událostí";
}

export { CZ_MONTH_NAMES };
