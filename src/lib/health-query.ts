import { prisma } from "./db";

export type DayPoint = {
  date: string; // ISO date YYYY-MM-DD
  value: number;
  count: number; // kolik samples se dostalo do tohoto dne
};

export type BpDayPoint = {
  date: string;
  systolic: number;
  diastolic: number;
};

export type SleepDayPoint = {
  date: string;
  total: number; // hodiny
  deep: number;
  rem: number;
  core: number;
  awake: number;
  inBedStart: string | null;
  inBedEnd: string | null;
};

export type SeriesStats = {
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  latest: number | null;
  latestAt: string | null;
  // Trend = rozdíl (první půlka období průměr) vs (druhá půlka průměr) / první půlka
  trendPct: number | null;
};

// ---- Helper: parse ISO date string bezpečně ----
function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeStats(values: number[], dates: string[]): SeriesStats {
  if (values.length === 0) {
    return { count: 0, avg: null, min: null, max: null, latest: null, latestAt: null, trendPct: null };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const min = values.reduce((a, b) => Math.min(a, b), values[0]);
  const max = values.reduce((a, b) => Math.max(a, b), values[0]);
  const latest = values[values.length - 1];
  const latestAt = dates[dates.length - 1];

  // Trend: porovnání průměrů první a druhé půlky
  let trendPct: number | null = null;
  if (values.length >= 4) {
    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid);
    const secondHalf = values.slice(mid);
    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (avg1 !== 0) trendPct = ((avg2 - avg1) / avg1) * 100;
  }

  return { count: values.length, avg, min, max, latest, latestAt, trendPct };
}

/**
 * Agreguje skalární metriku (qty) po dnech.
 * - aggregation "sum": kroky, energie, vzdálenost, schody, minuty aktivity
 * - aggregation "avg": HRV, klidový tep, dech, váha, tělesný tuk, rychlost chůze
 * - aggregation "latest": pro každý den vezmi poslední hodnotu (sparse metriky)
 */
export async function querySimpleMetric(
  userId: string,
  type: string,
  from: Date,
  to: Date,
  aggregation: "sum" | "avg" | "latest"
): Promise<{ points: DayPoint[]; stats: SeriesStats; unit: string | null }> {
  const rows = await prisma.healthMetric.findMany({
    where: { userId, type, recordedAt: { gte: from, lte: to }, qty: { not: null } },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, qty: true, unit: true },
  });

  const unit = rows[0]?.unit ?? null;

  // Seskup po dnech
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const key = toDayKey(r.recordedAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(r.qty as number);
  }

  const points: DayPoint[] = [];
  for (const [date, values] of Array.from(byDay.entries()).sort()) {
    let value: number;
    if (aggregation === "sum") value = values.reduce((a, b) => a + b, 0);
    else if (aggregation === "avg") value = values.reduce((a, b) => a + b, 0) / values.length;
    else value = values[values.length - 1];
    points.push({ date, value, count: values.length });
  }

  const stats = computeStats(
    points.map((p) => p.value),
    points.map((p) => p.date)
  );

  return { points, stats, unit };
}

export async function queryBloodPressure(
  userId: string,
  from: Date,
  to: Date
): Promise<{ points: BpDayPoint[]; systolicStats: SeriesStats; diastolicStats: SeriesStats }> {
  const rows = await prisma.healthMetric.findMany({
    where: {
      userId,
      type: "blood_pressure",
      recordedAt: { gte: from, lte: to },
      bpSystolic: { not: null },
      bpDiastolic: { not: null },
    },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, bpSystolic: true, bpDiastolic: true },
  });

  const points: BpDayPoint[] = rows.map((r) => ({
    date: r.recordedAt.toISOString(), // BP má časovou složku, nechceme slučovat po dnech
    systolic: r.bpSystolic as number,
    diastolic: r.bpDiastolic as number,
  }));

  const systolicStats = computeStats(
    rows.map((r) => r.bpSystolic as number),
    rows.map((r) => toDayKey(r.recordedAt))
  );
  const diastolicStats = computeStats(
    rows.map((r) => r.bpDiastolic as number),
    rows.map((r) => toDayKey(r.recordedAt))
  );

  return { points, systolicStats, diastolicStats };
}

export async function querySleep(
  userId: string,
  from: Date,
  to: Date
): Promise<{ points: SleepDayPoint[]; totalStats: SeriesStats; deepStats: SeriesStats; remStats: SeriesStats }> {
  const rows = await prisma.healthMetric.findMany({
    where: {
      userId,
      type: "sleep_analysis",
      recordedAt: { gte: from, lte: to },
    },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, sleepData: true },
  });

  // HAE může poslat víc sleep rows per den (např. nap + noční spánek = 2
  // záznamy se totalSleep 0.5 a 7). Předtím jsme každý row brali jako
  // samostatný point a počítali průměr přes všechny → naps zatáhly průměr
  // dolů (Petrův "0.5 h" bug). Teď agregujeme per kalendářní den.
  const asNum = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const asStr = (x: unknown) => (typeof x === "string" ? x : null);

  const byDay = new Map<string, SleepDayPoint>();
  for (const r of rows) {
    const d = (r.sleepData ?? {}) as Record<string, unknown>;
    const dayKey = toDayKey(r.recordedAt);
    const existing = byDay.get(dayKey);
    if (existing) {
      // Sečti všechny sleep rows daného dne (nap + noční)
      existing.total += asNum(d.totalSleep);
      existing.deep += asNum(d.deep);
      existing.rem += asNum(d.rem);
      existing.core += asNum(d.core);
      existing.awake += asNum(d.awake);
      // Pro inBed časy: prefer ten s vyšším totalSleep (= delší = nejspíš noční)
      const incoming = asNum(d.totalSleep);
      const incomingStart = asStr(d.inBedStart);
      const incomingEnd = asStr(d.inBedEnd);
      if (incoming > 4 && incomingStart && incomingEnd) {
        existing.inBedStart = incomingStart;
        existing.inBedEnd = incomingEnd;
      }
    } else {
      byDay.set(dayKey, {
        date: dayKey,
        total: asNum(d.totalSleep),
        deep: asNum(d.deep),
        rem: asNum(d.rem),
        core: asNum(d.core),
        awake: asNum(d.awake),
        inBedStart: asStr(d.inBedStart),
        inBedEnd: asStr(d.inBedEnd),
      });
    }
  }

  const points: SleepDayPoint[] = Array.from(byDay.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totalStats = computeStats(points.map((p) => p.total), points.map((p) => p.date));
  const deepStats = computeStats(points.map((p) => p.deep), points.map((p) => p.date));
  const remStats = computeStats(points.map((p) => p.rem), points.map((p) => p.date));

  return { points, totalStats, deepStats, remStats };
}

// Mapping metrika → způsob agregace
export const AGGREGATION_MAP: Record<string, "sum" | "avg" | "latest"> = {
  step_count: "sum",
  active_energy: "sum",
  basal_energy_burned: "sum",
  walking_running_distance: "sum",
  flights_climbed: "sum",
  apple_exercise_time: "sum",
  apple_stand_time: "sum",
  heart_rate_variability: "avg",
  resting_heart_rate: "avg",
  respiratory_rate: "avg",
  walking_step_length: "avg",
  physical_effort: "avg",
  cardio_recovery: "avg",
  weight_body_mass: "latest",
  body_fat_percentage: "latest",
};
