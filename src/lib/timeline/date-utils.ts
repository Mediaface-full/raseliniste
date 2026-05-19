/**
 * Date utility funkce pro Timeline View (F1).
 *
 * Petr 2026-05-19:
 * - ISO date string YYYY-MM-DD (UTC-safe, žádné posun kvůli TZ)
 * - Duration tag `t-*` formát: t-3d (dny), t-1w (týdny), t-2d, ...
 * - Sub-day tagy z memory (t-30m, t-1h, t-2h, t-půlden, t-celý-den) = 1 den
 * - Q-G priority: Todoist native duration → tag t-* → 1 den
 */

/** YYYY-MM-DD pro daný Date (v Europe/Prague). */
export function toIsoDate(d: Date): string {
  // Europe/Prague offset varies (CET/CEST), použijeme toLocaleString jako safe path
  const parts = d.toLocaleString("sv-SE", { timeZone: "Europe/Prague" }).slice(0, 10);
  // sv-SE locale vrátí "YYYY-MM-DD HH:mm:ss" → slice 10 = ISO date
  return parts;
}

/** YYYY-MM-DD → Date (v Praze, čas 00:00). */
export function fromIsoDate(iso: string): Date {
  // Konstruujeme jako UTC ať se nezasahuje TZ posun
  return new Date(`${iso}T00:00:00`);
}

/** Počet dní mezi dvěma ISO daty (b - a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = fromIsoDate(aIso).getTime();
  const b = fromIsoDate(bIso).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** Přidá `days` k ISO datu, vrátí ISO. */
export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/**
 * Parse duration z Todoist task data dle Q-G priority:
 *   1. native `durationMinutes` (Todoist API v1 vrací duration jako { amount, unit })
 *      → convert na dny (ceil), min 1
 *   2. tag `t-*`:
 *      - `t-<N>d`  → N dnů
 *      - `t-<N>w`  → N*7 dnů
 *      - jiné `t-*` (t-30m, t-1h, t-půlden) → 1 den (sub-day = 1 v timeline)
 *   3. žádný tag → 1 den
 */
export function parseDurationDays(input: {
  durationMinutes?: number | null;
  tags?: string[];
}): number {
  // (1) Todoist native duration
  if (input.durationMinutes && input.durationMinutes > 0) {
    return Math.max(1, Math.ceil(input.durationMinutes / (24 * 60)));
  }

  // (2) Tag t-*
  const tags = input.tags ?? [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag.startsWith("t-")) continue;
    const suffix = tag.slice(2);

    // t-3d, t-2d, t-30d
    const daysMatch = suffix.match(/^(\d+)d$/);
    if (daysMatch) return parseInt(daysMatch[1]!, 10);

    // t-1w, t-2w
    const weeksMatch = suffix.match(/^(\d+)w$/);
    if (weeksMatch) return parseInt(weeksMatch[1]!, 10) * 7;

    // Ostatní t-* (t-30m, t-1h, t-2h, t-pulden, t-půlden, t-celý-den, t-?) → 1 den
    return 1;
  }

  // (3) Default
  return 1;
}

/** Detekce milestone podle label/tag. Q-D: jednoduchý label "milestone". */
export function isMilestone(tags: string[]): boolean {
  return tags.some((t) => t.trim().toLowerCase() === "milestone");
}

/** Den v týdnu (0=ne, 1=po, ..., 6=so) — pro weekend coloring. */
export function dayOfWeek(iso: string): number {
  return fromIsoDate(iso).getDay();
}

/** Je víkend? */
export function isWeekend(iso: string): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

/** Formátování pro UI — krátký český zápis. */
export function formatDateShort(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    timeZone: "Europe/Prague",
  });
}

export function formatDateLong(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Prague",
  });
}

/** Pole dní mezi startem a endem (oba inclusive), ISO formát. */
export function dateRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const days = daysBetween(startIso, endIso);
  for (let i = 0; i <= days; i++) {
    out.push(addDays(startIso, i));
  }
  return out;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
