/**
 * Tři pravidelné rituály, které Petr ZAPOMÍNÁ a NEUMÍ si je v hlavě
 * vyvolat. Musí být vidět v týdenním pohledu jako bloky se stejnou
 * vizuální váhou jako schůzky — proto je vykreslujeme jako virtual events
 * (nezapisují se do CalendarEventu).
 *
 * - Ranní pohled na den — pondělí až pátek 07:00–08:00 (1h)
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
  description: string; // markdown návod co v rituálu dělat
  prepNote: null;
  itemsToBring: null;
}

export type RitualTemplates = {
  morning_day?: string;
  friday_reflection?: string;
  weekly_review?: string;
};

/**
 * Default texty rituálů. Petr je může v /settings/ritualy přepsat.
 */
export const DEFAULT_RITUAL_TEMPLATES: Required<RitualTemplates> = {
  morning_day: `## Ranní pohled na den (7:00–8:00)

Hodina ke spuštění dne. Bez spěchu.

**Tělo a hlava**
- Voda, něco malého k jídlu
- 2 minuty dechu, ne na telefonu

**Přehled dne**
- Otevři kalendář na dnešek
- Co je největší věc dne? Co to vyžaduje?
- Co můžu zrušit nebo přesunout, pokud potřebuju?

**Příprava**
- Co si mám vzít s sebou (auto, kufr, kamera)?
- Komu mám psát/volat?

**Záměr**
- Jedna věta: čeho chci dnes dosáhnout?
- Co mě může vyvést z míry, jak na to budu reagovat?`,

  friday_reflection: `## Páteční reflexe (Pá 17:00–17:15)

15 minut, klidně se zápisem v deníku.

- Co se podařilo tento týden?
- Co mě překvapilo (pozitivně i jinak)?
- Co mě stálo nejvíc energie?
- Co příští týden potřebuje pozornost?
- 3 věci za které jsem vděčný (může být drobnost)`,

  weekly_review: `## Nedělní pohled na týden (Ne 18:00–18:15)

Otevři kalendář na příští týden a projdi si to.

- Hlavní 3 věci, které musím v týdnu zvládnout
- Kde mám volné okno pro hlubokou práci?
- Co potřebuji připravit dopředu?
- Kde se setkám s lidmi (rodina, klienti, přátelé)?
- Energetická bilance: kde nabírám, kde dávám?
- Jeden úkol na pondělí ráno (konkrétní krok)`,
};

/** Vrátí popisek pro daný rituál — nejdřív custom, pak default. */
export function ritualDescription(
  type: RitualType,
  custom: RitualTemplates | null | undefined,
): string {
  const fromCustom = custom?.[type]?.trim();
  if (fromCustom && fromCustom.length > 0) return fromCustom;
  return DEFAULT_RITUAL_TEMPLATES[type];
}

/**
 * Vygeneruje rituály pro daný týden (Po-Ne).
 * `weekStartMonday` musí být půlnoc pondělí.
 * `customTemplates` přepíše default popisky (z User.ritualTemplates).
 */
export function generateWeekRituals(
  weekStartMonday: Date,
  customTemplates?: RitualTemplates | null,
): RitualEvent[] {
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

    // Ranní pohled na den — pondělí až pátek 07:00–08:00 (1h)
    if (dow >= 0 && dow <= 4) {
      const morning = pragueDate(year, month, day, 7, 0);
      const morningEnd = pragueDate(year, month, day, 8, 0);
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
        description: ritualDescription("morning_day", customTemplates),
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
        description: ritualDescription("friday_reflection", customTemplates),
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
        description: ritualDescription("weekly_review", customTemplates),
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

// ===========================================================================
// Vlastní rituály (CustomRitual) — nad rámec 3 default
// ===========================================================================

export interface CustomRitualInput {
  id: string;
  title: string;
  description: string | null;
  daysOfWeek: number[]; // 0=Po, 6=Ne
  startHour: number;
  startMinute: number;
  durationMin: number;
}

/**
 * Vygeneruje virtual events pro custom rituály v daném týdnu.
 * Pro každý rituál a každý den v `daysOfWeek` vyrobí jeden RitualEvent.
 */
export function generateCustomRituals(
  weekStartMonday: Date,
  customRituals: CustomRitualInput[],
): RitualEvent[] {
  const out: RitualEvent[] = [];
  for (let i = 0; i < 7; i++) {
    const calDate = new Date(weekStartMonday);
    calDate.setDate(calDate.getDate() + i);
    const year = calDate.getFullYear();
    const month = calDate.getMonth() + 1;
    const day = calDate.getDate();
    const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    for (const r of customRituals) {
      if (!r.daysOfWeek.includes(i)) continue;
      const start = pragueDate(year, month, day, r.startHour, r.startMinute);
      const end = new Date(start.getTime() + r.durationMin * 60_000);
      out.push({
        id: `ritual-custom-${r.id}-${isoDate}`,
        title: r.title,
        // Custom rituály nemají pevný RitualType — používáme generic "morning_day"
        // jako placeholder (pro routing fallback v ritualDescription nepoužíváme,
        // description posíláme přímo z DB níže).
        ritualType: "morning_day",
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        source: "RITUAL",
        type: "RITUAL",
        locationText: null,
        description: r.description?.trim() || `## ${r.title}\n\n*(Bez popisku — uprav v /settings/ritualy)*`,
        prepNote: null,
        itemsToBring: null,
      });
    }
  }
  return out;
}

export const DAY_NAMES_CZ: ReadonlyArray<string> = [
  "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle",
];
export const DAY_NAMES_SHORT_CZ: ReadonlyArray<string> = [
  "Po", "Út", "St", "Čt", "Pá", "So", "Ne",
];

/** Lidsky čitelný popis opakování. */
export function formatRecurrence(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 0) return "(neaktivní)";
  if (daysOfWeek.length === 7) return "Každý den";
  const sorted = [...daysOfWeek].sort();
  const isWeekdays = sorted.length === 5 && sorted.every((d, i) => d === i);
  if (isWeekdays) return "Pracovní dny (Po–Pá)";
  const isWeekend = sorted.length === 2 && sorted[0] === 5 && sorted[1] === 6;
  if (isWeekend) return "Víkend (So–Ne)";
  return sorted.map((d) => DAY_NAMES_SHORT_CZ[d]).join(", ");
}
