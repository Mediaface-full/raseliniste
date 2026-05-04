/**
 * Tři pravidelné rituály, které Petr ZAPOMÍNÁ a NEUMÍ si je v hlavě
 * vyvolat. Musí být vidět v týdenním pohledu jako bloky se stejnou
 * vizuální váhou jako schůzky — proto je vykreslujeme jako virtual events
 * (nezapisují se do CalendarEventu).
 *
 * - Ranní pohled na den — každý den 08:00, 5 min
 * - Páteční reflexe — pátek 17:00, 15 min
 * - Nedělní pohled na týden — neděle 18:00, 15 min
 *
 * Vykreslujeme s tečkovaným okrajem + tint-peach (oddělená barva mimo
 * kalendářové) — viz WeekView. Tady jen generujeme data.
 */

export type RitualType = "morning_day" | "friday_reflection" | "weekly_review";

export interface RitualEvent {
  id: string;
  title: string;
  ritualType: RitualType;
  startsAt: string; // ISO
  endsAt: string;
  allDay: false;
  source: "RITUAL"; // mimo CalendarSource enum — speciální marker
  type: "RITUAL";
  locationText: null;
  description: null;
  prepNote: null;
  itemsToBring: null;
}

/**
 * Vygeneruje rituály pro daný týden (Po-Ne).
 * `weekStartMonday` musí být půlnoc pondělí.
 */
export function generateWeekRituals(weekStartMonday: Date): RitualEvent[] {
  const rituals: RitualEvent[] = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStartMonday);
    day.setDate(day.getDate() + i);
    day.setHours(0, 0, 0, 0);
    const dow = i; // 0 = Po, ..., 4 = Pá, 5 = So, 6 = Ne

    // Ranní pohled na den — každý den 08:00, 5 min
    const morning = new Date(day);
    morning.setHours(8, 0, 0, 0);
    const morningEnd = new Date(morning.getTime() + 5 * 60_000);
    rituals.push({
      id: `ritual-morning-${day.toISOString().slice(0, 10)}`,
      title: "Ranní pohled na den",
      ritualType: "morning_day",
      startsAt: morning.toISOString(),
      endsAt: morningEnd.toISOString(),
      allDay: false,
      source: "RITUAL",
      type: "RITUAL",
      locationText: null,
      description: null,
      prepNote: null,
      itemsToBring: null,
    });

    // Páteční reflexe — pátek 17:00, 15 min
    if (dow === 4) {
      const reflection = new Date(day);
      reflection.setHours(17, 0, 0, 0);
      const end = new Date(reflection.getTime() + 15 * 60_000);
      rituals.push({
        id: `ritual-friday-${day.toISOString().slice(0, 10)}`,
        title: "Páteční reflexe",
        ritualType: "friday_reflection",
        startsAt: reflection.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        source: "RITUAL",
        type: "RITUAL",
        locationText: null,
        description: null,
        prepNote: null,
        itemsToBring: null,
      });
    }

    // Nedělní pohled na týden — neděle 18:00, 15 min
    if (dow === 6) {
      const review = new Date(day);
      review.setHours(18, 0, 0, 0);
      const end = new Date(review.getTime() + 15 * 60_000);
      rituals.push({
        id: `ritual-sunday-${day.toISOString().slice(0, 10)}`,
        title: "Nedělní pohled na týden",
        ritualType: "weekly_review",
        startsAt: review.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        source: "RITUAL",
        type: "RITUAL",
        locationText: null,
        description: null,
        prepNote: null,
        itemsToBring: null,
      });
    }
  }

  return rituals;
}

/** Vrátí pondělí na 00:00 lokálně (Europe/Prague v praxi přes server tz). */
export function getMondayOfWeek(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  // getDay: 0 = Ne, 1 = Po, ..., 6 = So
  const dow = result.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  result.setDate(result.getDate() + offsetToMonday);
  return result;
}

/** Vrátí neděli 23:59:59.999 daného týdne. */
export function getSundayOfWeek(monday: Date): Date {
  const result = new Date(monday);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}
