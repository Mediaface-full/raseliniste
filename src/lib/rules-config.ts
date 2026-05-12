/**
 * Hardcoded scheduling config pro fázi 1b. Pozdější iterace:
 * přesun do DB s editací přes /calendar/settings (fáze 4 v briefu).
 *
 * Den-of-week konvence: 0=Sunday, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
 */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DAYS = {
  SUN: 0 as DayOfWeek,
  MON: 1 as DayOfWeek,
  TUE: 2 as DayOfWeek,
  WED: 3 as DayOfWeek,
  THU: 4 as DayOfWeek,
  FRI: 5 as DayOfWeek,
  SAT: 6 as DayOfWeek,
} as const;

export interface SchedulingConfig {
  pragueDays: DayOfWeek[];
  pragueHours: { start: string; end: string }; // "HH:MM"
  homeDays: DayOfWeek[];
  homeHours: { start: string; end: string };
  onlineDays: DayOfWeek[];
  onlineHours: { start: string; end: string };
  lunchBreak: { start: string; end: string };
  endOfDay: string;
  bufferPragueMinutes: number;
  bufferOnlineBetweenMinutes: number;
  minLeadTimeClientHours: number;
  minLeadTimeFriendHours: number;
  maxBookingHorizonDays: number;
  // Limity per den
  maxPragueWarning: number;       // > tento count → WARNING
  maxInPersonWarning: number;
  maxInPersonError: number;
  maxOnlineWarning: number;
  weightedLoadWarning: number;    // prezenční=1.0, online=0.6
  weightedLoadError: number;
}

export const SCHEDULING_CONFIG: SchedulingConfig = {
  pragueDays: [DAYS.TUE, DAYS.WED],
  pragueHours: { start: "09:00", end: "17:00" },
  homeDays: [DAYS.MON, DAYS.THU, DAYS.FRI],
  homeHours: { start: "09:00", end: "17:00" },
  // Online dny: brief má dilema "i út/st jako přídavek? Petre, řekni si."
  // Default: všechny pracovní dny — Petr může zúžit přes /calendar/settings.
  // Středa pryč — odpoledne syn (hokej, kroužky). Online dny Po/Út/Čt/Pá.
  onlineDays: [DAYS.MON, DAYS.TUE, DAYS.THU, DAYS.FRI],
  onlineHours: { start: "09:00", end: "17:00" },
  lunchBreak: { start: "12:00", end: "13:00" },
  endOfDay: "17:00",
  bufferPragueMinutes: 60,
  bufferOnlineBetweenMinutes: 30,
  minLeadTimeClientHours: 72,
  minLeadTimeFriendHours: 24,
  maxBookingHorizonDays: 30,
  maxPragueWarning: 1,        // 2+ → warning
  maxInPersonWarning: 1,      // 2+ → warning
  maxInPersonError: 2,        // 3+ → error
  maxOnlineWarning: 2,        // 3+ → warning
  weightedLoadWarning: 2.5,
  weightedLoadError: 3.5,
};

export function dowOf(d: Date): DayOfWeek {
  return d.getDay() as DayOfWeek;
}

/**
 * Parse "HH:MM" + datum → Date v Europe/Prague časové zóně (lokální Date object).
 * Pro server běžící v UTC kontejneru: počítáme "co Petr vidí" — tj. lokální čas
 * ve smyslu Europe/Prague. V kontejneru je TZ=Europe/Prague (compose env).
 */
export function timeOnDate(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const out = new Date(date);
  out.setHours(h, m, 0, 0);
  return out;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
