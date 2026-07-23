/**
 * Šablona týdne (theme days) — ADHD F3, Petr 2026-07-22.
 * Sdílený přístup pro board, AI plánování a rules.ts (soft warning
 * schůzky v maker/own dni). Cache 5 min (single-user, mění se zřídka).
 */

import { prisma } from "./db";

export type DayMode = "manager" | "maker" | "own" | "off";

export interface TemplateDay {
  mode: DayMode;
  label: string | null;
}

export const MODE_INFO: Record<DayMode, { name: string; tint: string; hint: string }> = {
  manager: { name: "Manager", tint: "sky",    hint: "schůzky, hovory, admin" },
  maker:   { name: "Maker",   tint: "peach",  hint: "deep work — klienti" },
  own:     { name: "Vlastní", tint: "butter", hint: "vlastní projekty — nedotknutelné" },
  off:     { name: "Volno",   tint: "sage",   hint: "neplánovat práci" },
};

let cache: { fetchedAt: number; map: Map<number, TemplateDay> } | null = null;

/** Mapa weekday (0=Po … 6=Ne) → šablona. Prázdná mapa = šablona nenastavená. */
export async function getWeekTemplate(): Promise<Map<number, TemplateDay>> {
  if (cache && Date.now() - cache.fetchedAt < 5 * 60 * 1000) return cache.map;
  const rows = await prisma.planningDayTemplate.findMany();
  const map = new Map<number, TemplateDay>();
  for (const r of rows) map.set(r.weekday, { mode: r.mode as DayMode, label: r.label });
  cache = { fetchedAt: Date.now(), map };
  return map;
}

export function invalidateWeekTemplateCache(): void {
  cache = null;
}

/** JS Date → náš weekday (0=Po … 6=Ne, Europe/Prague semantika lokálního data) */
export function weekdayOf(d: Date): number {
  return (d.getDay() + 6) % 7;
}
