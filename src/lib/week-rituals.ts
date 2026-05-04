/**
 * Tři pravidelné rituály, které Petr ZAPOMÍNÁ a NEUMÍ si je v hlavě
 * vyvolat. Musí být vidět v týdenním pohledu jako bloky se stejnou
 * vizuální váhou jako schůzky — proto je vykreslujeme jako virtual events
 * (nezapisují se do CalendarEventu).
 *
 * - Ranní pohled na den — pondělí až pátek 08:00, 5 min (5 ranních)
 * - Páteční reflexe — pátek 17:00, 15 min
 * - Nedělní pohled na týden — neděle 18:00, 15 min
 * Celkem max 7 rituálních bloků v týdnu.
 *
 * POZOR: časy jsou v PRAHA TZ. Server může běžet v UTC, takže používáme
 * pragueDate helper. Bez něj se ranní 8:00 zobrazí v UI jako 10:00 (CEST).
 */
import { pragueDate } from "./prague-tz";

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
    // Spočítej kalendářní rok/měsíc/den pro Po+i (v Praze)
    const calDate = new Date(weekStartMonday);
    calDate.setDate(calDate.getDate() + i);
    const year = calDate.getFullYear();
    const month = calDate.getMonth() + 1; // 1-based
    const day = calDate.getDate();
    const dow = i; // 0 = Po, ..., 4 = Pá, 5 = So, 6 = Ne
    const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Ranní pohled na den — pondělí až pátek 08:00, 5 min (Petr explicit:
    // víkendy nepatří mezi pracovní rituály, ne každý den)
    if (dow >= 0 && dow <= 4) {
      const morning = pragueDate(year, month, day, 8, 0);
      const morningEnd = new Date(morning.getTime() + 5 * 60_000);
      rituals.push({
        id: `ritual-morning-${isoDate}`,
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
    }

    // Páteční reflexe — pátek 17:00, 15 min
    if (dow === 4) {
      const reflection = pragueDate(year, month, day, 17, 0);
      const end = new Date(reflection.getTime() + 15 * 60_000);
      rituals.push({
        id: `ritual-friday-${isoDate}`,
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
      const review = pragueDate(year, month, day, 18, 0);
      const end = new Date(review.getTime() + 15 * 60_000);
      rituals.push({
        id: `ritual-sunday-${isoDate}`,
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
