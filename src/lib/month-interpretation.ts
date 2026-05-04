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

export function interpretMonth(
  monthStart: Date, // první den v měsíci
  events: BasicEvent[],
): { lines: string[]; bigEvents: Array<{ title: string; date: string; source: string }> } {
  const lines: string[] = [];
  const today = new Date();

  // 1. Kolik dní zbývá v měsíci
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  if (
    today.getFullYear() === monthStart.getFullYear() &&
    today.getMonth() === monthStart.getMonth()
  ) {
    const daysLeft = monthEnd.getDate() - today.getDate() + 1;
    lines.push(`${daysLeft} ${formatDaysWord(daysLeft)} v tomto měsíci`);
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
      return `${b.title} (${d.getDate()}.${d.getMonth() + 1}.)`;
    });
    lines.push(`${bigEvents.length} ${formatBigEventsWord(bigEvents.length)}: ${labels.join(", ")}`);
  } else if (bigEvents.length > 5) {
    lines.push(`${bigEvents.length} velkých událostí v měsíci`);
  }

  // 3. Najdi nejhustší týden v měsíci
  // Group events by ISO week
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
      `Nejhustší týden ${ws.getDate()}.–${we.getDate()}.${we.getMonth() + 1}. (${weeks[0].count} událostí)`,
    );
  }

  // 4. Volné dny
  const freeDays = countFreeDays(monthStart, monthEnd, events);
  if (freeDays > 0) {
    lines.push(`${freeDays} ${formatDaysWord(freeDays)} bez události`);
  }

  return { lines: lines.slice(0, 4), bigEvents };
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
