/**
 * Interpretační lišta pro týdenní pohled.
 *
 * Petr nedokáže ze surového kalendáře odvodit, co týden znamená.
 * Aplikace mu vrátí 4-6 krátkých faktických vět.
 *
 * VAROVÁNÍ: lišta nehodnotí. Ne "tento týden je přepracovaný" ale
 * "38 hodin obsazeno." Petr si soud udělá sám.
 */

interface BasicEvent {
  source: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

const DAY_NAMES = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];

export function interpretWeek(
  weekMonday: Date,
  events: BasicEvent[],
  ritualsCount: number,
): string[] {
  const lines: string[] = [];

  // Filtr: jen časované eventy (allDay neblokují čas v kalkulaci hodin)
  const timed = events.filter((e) => !e.allDay);
  const allDayCount = events.filter((e) => e.allDay).length;

  // 1. Hodiny obsazené
  let busyMinutes = 0;
  for (const e of timed) {
    busyMinutes += (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60_000;
  }
  const busyHours = Math.round(busyMinutes / 60);
  const totalAvailableHours = 7 * 17; // 7 dní × 17 hodin (6:00-23:00)
  lines.push(`${busyHours} hodin obsazeno z ${totalAvailableHours} dostupných`);

  // 2. Nejhustší den
  const perDay = new Array(7).fill(0).map(() => ({ count: 0, dayIndex: 0 }));
  for (const e of timed) {
    const start = new Date(e.startsAt);
    const dow = (start.getDay() + 6) % 7; // přemapuj Ne=0 → Po=0
    perDay[dow].count++;
    perDay[dow].dayIndex = dow;
  }
  const sortedByCount = [...perDay].sort((a, b) => b.count - a.count);
  if (sortedByCount[0].count > 0) {
    lines.push(
      `${capitalize(DAY_NAMES[sortedByCount[0].dayIndex])} je nejhustší den (${sortedByCount[0].count} ${formatEventsCount(sortedByCount[0].count)})`,
    );
  }

  // 3. Volné dopoledne / odpoledne — najdi den s 0 events do 12:00 nebo po 13:00
  for (let dow = 0; dow < 7; dow++) {
    const day = new Date(weekMonday);
    day.setDate(day.getDate() + dow);
    const morningStart = new Date(day);
    morningStart.setHours(6, 0, 0, 0);
    const noon = new Date(day);
    noon.setHours(12, 0, 0, 0);
    const afternoonEnd = new Date(day);
    afternoonEnd.setHours(18, 0, 0, 0);

    const morningEvents = timed.filter((e) => {
      const s = new Date(e.startsAt).getTime();
      return s >= morningStart.getTime() && s < noon.getTime();
    });
    const afternoonEvents = timed.filter((e) => {
      const s = new Date(e.startsAt).getTime();
      return s >= noon.getTime() && s < afternoonEnd.getTime();
    });
    if (morningEvents.length === 0 && (dow === 5 || dow === 6)) {
      lines.push(`${capitalize(DAY_NAMES[dow])} dopoledne je úplně volná`);
      break;
    }
    if (afternoonEvents.length === 0 && (dow === 5 || dow === 6)) {
      lines.push(`${capitalize(DAY_NAMES[dow])} odpoledne je úplně volná`);
      break;
    }
  }

  // 4. Nejdelší souvislý volný blok pro hlubokou práci (≥2h, mezi 9-17 v Po-Pá)
  let longestFreeMinutes = 0;
  for (let dow = 0; dow < 5; dow++) {
    const day = new Date(weekMonday);
    day.setDate(day.getDate() + dow);
    const workStart = new Date(day);
    workStart.setHours(9, 0, 0, 0);
    const workEnd = new Date(day);
    workEnd.setHours(17, 0, 0, 0);

    const dayEvents = timed
      .filter((e) => {
        const s = new Date(e.startsAt).getTime();
        const en = new Date(e.endsAt).getTime();
        return en > workStart.getTime() && s < workEnd.getTime();
      })
      .map((e) => ({
        start: Math.max(new Date(e.startsAt).getTime(), workStart.getTime()),
        end: Math.min(new Date(e.endsAt).getTime(), workEnd.getTime()),
      }))
      .sort((a, b) => a.start - b.start);

    let cursor = workStart.getTime();
    for (const ev of dayEvents) {
      if (ev.start > cursor) {
        longestFreeMinutes = Math.max(longestFreeMinutes, (ev.start - cursor) / 60_000);
      }
      cursor = Math.max(cursor, ev.end);
    }
    if (workEnd.getTime() > cursor) {
      longestFreeMinutes = Math.max(longestFreeMinutes, (workEnd.getTime() - cursor) / 60_000);
    }
  }
  if (longestFreeMinutes < 120) {
    lines.push("Žádný blok delší než 2 hodiny pro hlubokou práci");
  } else {
    const h = Math.floor(longestFreeMinutes / 60);
    lines.push(`Nejdelší souvislé volné okno v pracovní době: ${h} h`);
  }

  // 5. Rituály
  if (ritualsCount > 0) {
    lines.push(`${ritualsCount} rituálů v týdnu naplánovaných`);
  }

  // 6. Bez partnerky? Zkontroluj jestli je ve týdnu nějaký event s `ICLOUD_PARTNER` source
  const hasPartner = events.some((e) => e.source === "ICLOUD_PARTNER");
  if (!hasPartner) {
    lines.push("Žádná událost s partnerkou tento týden");
  }

  // 7. Allday eventy (informativní)
  if (allDayCount > 0) {
    lines.push(`${allDayCount} ${formatEventsCount(allDayCount)} na celý den`);
  }

  return lines.slice(0, 6);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatEventsCount(n: number): string {
  if (n === 1) return "událost";
  if (n >= 2 && n <= 4) return "události";
  return "událostí";
}
