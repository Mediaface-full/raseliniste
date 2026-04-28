import { prisma } from "./db";
import type { EcgRow, MetricRow } from "./health-parser";

export type ImportStats = {
  metricsInserted: number;
  metricsSkippedDuplicate: number;
  ecgsInserted: number;
  ecgsSkippedDuplicate: number;
  durationMs: number;
};

const BATCH_SIZE = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Bulk insert metrik + EKG s dedupe přes unique index.
 * Používáme `createMany({ skipDuplicates: true })` → Postgres generuje
 * `INSERT ... ON CONFLICT DO NOTHING`, takže re-ingest je levný.
 *
 * `skipDuplicates` vrací `count` POUZE úspěšně vložených řádků.
 * Skipped = batch.length - result.count.
 */
export async function importHealthRows(
  userId: string,
  metrics: MetricRow[],
  ecgs: EcgRow[]
): Promise<ImportStats> {
  const start = Date.now();
  let metricsInserted = 0;
  let metricsSkipped = 0;

  for (const batch of chunk(metrics, BATCH_SIZE)) {
    const data = batch.map((m) => ({
      userId,
      type: m.type,
      recordedAt: m.recordedAt,
      source: m.source,
      unit: m.unit,
      qty: m.qty,
      bpSystolic: m.bpSystolic,
      bpDiastolic: m.bpDiastolic,
      sleepData: m.sleepData ?? undefined,
      raw: m.raw ?? undefined,
    }));
    // Cast — Prisma JSON pole akceptují běžné objekty, ale TS striktní type
    // si stěžuje na Record<string, unknown> vs InputJsonValue.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await prisma.healthMetric.createMany({
      data: data as any,
      skipDuplicates: true,
    });
    metricsInserted += res.count;
    metricsSkipped += batch.length - res.count;
  }

  let ecgsInserted = 0;
  let ecgsSkipped = 0;
  for (const batch of chunk(ecgs, BATCH_SIZE)) {
    const data = batch.map((e) => ({
      userId,
      startedAt: e.startedAt,
      source: e.source,
      classification: e.classification,
      averageHr: e.averageHr,
      voltageData: e.voltageData ?? undefined,
      symptoms: e.symptoms ?? undefined,
      raw: e.raw ?? undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await prisma.healthEcg.createMany({
      data: data as any,
      skipDuplicates: true,
    });
    ecgsInserted += res.count;
    ecgsSkipped += batch.length - res.count;
  }

  return {
    metricsInserted,
    metricsSkippedDuplicate: metricsSkipped,
    ecgsInserted,
    ecgsSkippedDuplicate: ecgsSkipped,
    durationMs: Date.now() - start,
  };
}
