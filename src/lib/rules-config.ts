/**
 * Scheduling config — historicky hardcoded, od 2026-05-13 v DB tabulce
 * SchedulingConfig editovatelné z /calendar/settings.
 *
 * API:
 *   - `getSchedulingConfig()` — async, vrátí current config (cache 60s in-memory)
 *   - `invalidateConfigCache()` — vola se po PUT v /api/calendar/settings
 *   - `DEFAULT_CONFIG` — default hodnoty pro seed při prvním načtení
 *
 * Den-of-week konvence: 0=Sunday, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
 */

import { prisma } from "./db";

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
  pragueHours: { start: string; end: string };
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
  maxPragueWarning: number;
  maxInPersonWarning: number;
  maxInPersonError: number;
  maxOnlineWarning: number;
  weightedLoadWarning: number;
  weightedLoadError: number;
}

/**
 * Default config — použije se při prvním načtení (auto-seed do DB) nebo
 * jako fallback pokud DB row neexistuje.
 *
 * Hodnoty 2026-05-13: 09–17, středa pryč online, lead 72/24 (Petrovo zadání
 * po nasazení booking modulu).
 */
export const DEFAULT_CONFIG: SchedulingConfig = {
  pragueDays: [DAYS.TUE, DAYS.WED],
  pragueHours: { start: "09:00", end: "17:00" },
  homeDays: [DAYS.MON, DAYS.THU, DAYS.FRI],
  homeHours: { start: "09:00", end: "17:00" },
  onlineDays: [DAYS.MON, DAYS.TUE, DAYS.THU, DAYS.FRI],
  onlineHours: { start: "09:00", end: "17:00" },
  lunchBreak: { start: "12:00", end: "13:00" },
  endOfDay: "17:00",
  bufferPragueMinutes: 60,
  bufferOnlineBetweenMinutes: 30,
  minLeadTimeClientHours: 72,
  minLeadTimeFriendHours: 24,
  maxBookingHorizonDays: 30,
  maxPragueWarning: 1,
  maxInPersonWarning: 1,
  maxInPersonError: 2,
  maxOnlineWarning: 2,
  weightedLoadWarning: 2.5,
  weightedLoadError: 3.5,
};

// In-memory cache. Single-user instance → single config. TTL 60s pro případy
// kdy zápis přijde z jiného workeru, ale defenzivně invalidujeme i přímo
// při PUT z /api/calendar/settings.
let cached: { config: SchedulingConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getSchedulingConfig(): Promise<SchedulingConfig> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.config;

  // Single-user systém — vezmi první (a jediný) user a jeho config.
  // Pokud config ještě neexistuje, vytvoř s defaults (lazy seed).
  const row = await prisma.schedulingConfig.findFirst();
  let config: SchedulingConfig;
  if (row) {
    config = rowToConfig(row);
  } else {
    // Lazy seed — najdi jediného usera a vytvoř default config
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (user) {
      const created = await prisma.schedulingConfig.create({
        data: configToRow(DEFAULT_CONFIG, user.id),
      });
      config = rowToConfig(created);
    } else {
      // Edge case — žádný user neexistuje (čerstvá DB). Vrať default in-memory.
      config = DEFAULT_CONFIG;
    }
  }

  cached = { config, expiresAt: now + CACHE_TTL_MS };
  return config;
}

export function invalidateConfigCache(): void {
  cached = null;
}

/**
 * Update + persist + invalidate cache. Volá se z /api/calendar/settings PUT.
 */
export async function saveSchedulingConfig(userId: string, config: SchedulingConfig): Promise<SchedulingConfig> {
  const data = configToRow(config, userId);
  await prisma.schedulingConfig.upsert({
    where: { userId },
    create: data,
    update: data,
  });
  invalidateConfigCache();
  return config;
}

// ---- DB row ↔ structured config mapping --------------------------------

type DbRow = {
  pragueDays: number[];
  pragueHoursStart: string;
  pragueHoursEnd: string;
  homeDays: number[];
  homeHoursStart: string;
  homeHoursEnd: string;
  onlineDays: number[];
  onlineHoursStart: string;
  onlineHoursEnd: string;
  lunchBreakStart: string;
  lunchBreakEnd: string;
  endOfDay: string;
  bufferPragueMinutes: number;
  bufferOnlineBetweenMinutes: number;
  minLeadTimeClientHours: number;
  minLeadTimeFriendHours: number;
  maxBookingHorizonDays: number;
  maxPragueWarning: number;
  maxInPersonWarning: number;
  maxInPersonError: number;
  maxOnlineWarning: number;
  weightedLoadWarning: number;
  weightedLoadError: number;
};

function rowToConfig(r: DbRow): SchedulingConfig {
  return {
    pragueDays: r.pragueDays.map((d) => d as DayOfWeek),
    pragueHours: { start: r.pragueHoursStart, end: r.pragueHoursEnd },
    homeDays: r.homeDays.map((d) => d as DayOfWeek),
    homeHours: { start: r.homeHoursStart, end: r.homeHoursEnd },
    onlineDays: r.onlineDays.map((d) => d as DayOfWeek),
    onlineHours: { start: r.onlineHoursStart, end: r.onlineHoursEnd },
    lunchBreak: { start: r.lunchBreakStart, end: r.lunchBreakEnd },
    endOfDay: r.endOfDay,
    bufferPragueMinutes: r.bufferPragueMinutes,
    bufferOnlineBetweenMinutes: r.bufferOnlineBetweenMinutes,
    minLeadTimeClientHours: r.minLeadTimeClientHours,
    minLeadTimeFriendHours: r.minLeadTimeFriendHours,
    maxBookingHorizonDays: r.maxBookingHorizonDays,
    maxPragueWarning: r.maxPragueWarning,
    maxInPersonWarning: r.maxInPersonWarning,
    maxInPersonError: r.maxInPersonError,
    maxOnlineWarning: r.maxOnlineWarning,
    weightedLoadWarning: r.weightedLoadWarning,
    weightedLoadError: r.weightedLoadError,
  };
}

function configToRow(c: SchedulingConfig, userId: string) {
  return {
    userId,
    pragueDays: c.pragueDays,
    pragueHoursStart: c.pragueHours.start,
    pragueHoursEnd: c.pragueHours.end,
    homeDays: c.homeDays,
    homeHoursStart: c.homeHours.start,
    homeHoursEnd: c.homeHours.end,
    onlineDays: c.onlineDays,
    onlineHoursStart: c.onlineHours.start,
    onlineHoursEnd: c.onlineHours.end,
    lunchBreakStart: c.lunchBreak.start,
    lunchBreakEnd: c.lunchBreak.end,
    endOfDay: c.endOfDay,
    bufferPragueMinutes: c.bufferPragueMinutes,
    bufferOnlineBetweenMinutes: c.bufferOnlineBetweenMinutes,
    minLeadTimeClientHours: c.minLeadTimeClientHours,
    minLeadTimeFriendHours: c.minLeadTimeFriendHours,
    maxBookingHorizonDays: c.maxBookingHorizonDays,
    maxPragueWarning: c.maxPragueWarning,
    maxInPersonWarning: c.maxInPersonWarning,
    maxInPersonError: c.maxInPersonError,
    maxOnlineWarning: c.maxOnlineWarning,
    weightedLoadWarning: c.weightedLoadWarning,
    weightedLoadError: c.weightedLoadError,
  };
}

// ---- Helpers (z původního souboru) ------------------------------------

export function dowOf(d: Date): DayOfWeek {
  return d.getDay() as DayOfWeek;
}

export function timeOnDate(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const out = new Date(date);
  out.setHours(h, m, 0, 0);
  return out;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
