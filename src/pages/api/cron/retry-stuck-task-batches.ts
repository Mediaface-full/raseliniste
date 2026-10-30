import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processTaskAudio, getInFlightTaskAudioSnapshot } from "@/lib/process-task-audio";

export const prerender = false;

/**
 * POST /api/cron/retry-stuck-task-batches
 * Auth: x-cron-key
 * Schedule: každých 5 min
 *
 * Pickne TaskAudioBatch ve stavu "processing" starší než 5 min — typicky
 * uvázly při restartu kontejneru (fire-and-forget Promise umřela).
 * Spustí processTaskAudio znovu z uloženého audia.
 *
 * 2026-10-30: přeskočí dávky, které v tomto procesu právě běží (dlouhé audio
 * > 5 min dostávalo každých 5 min souběžnou kopii vč. Pro extrakce), a dávky
 * starší MAX_AGE_HOURS označí jako error místo retry navždy.
 */
const STUCK_THRESHOLD_MIN = 5;
const MAX_AGE_HOURS = 2;
const MAX_RETRIES_PER_RUN = 5;

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000);

  const maxAge = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
  await prisma.taskAudioBatch.updateMany({
    where: { status: "processing", createdAt: { lt: maxAge } },
    data: { status: "error", processingError: `Auto-retry: zpracování nedoběhlo do ${MAX_AGE_HOURS} h, vzdávám. Zkus nahrát znovu.` },
  });

  const running = new Set(getInFlightTaskAudioSnapshot().map((f) => f.batchId));
  const stuck = await prisma.taskAudioBatch.findMany({
    where: {
      status: "processing",
      createdAt: { lt: cutoff, gte: maxAge },
      ...(running.size > 0 ? { id: { notIn: [...running] } } : {}),
    },
    take: MAX_RETRIES_PER_RUN,
    orderBy: { createdAt: "asc" },
  });

  const results: Array<{ id: string; ageMin: number; action: string; error?: string }> = [];

  for (const b of stuck) {
    const ageMin = Math.round((Date.now() - b.createdAt.getTime()) / 60000);

    if (!b.audioPath || !(await uploadExists(b.audioPath))) {
      await prisma.taskAudioBatch.update({
        where: { id: b.id },
        data: {
          status: "error",
          processingError: "Auto-retry: audio už není na disku, nelze obnovit.",
        },
      });
      results.push({ id: b.id, ageMin, action: "skipped_no_audio" });
      continue;
    }

    try {
      const audio = await readUpload(b.audioPath);
      void processTaskAudio({
        batchId: b.id,
        audio,
        mimeType: b.audioMime ?? "audio/webm",
      });
      results.push({ id: b.id, ageMin, action: "retried" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.taskAudioBatch.update({
        where: { id: b.id },
        data: { status: "error", processingError: `Auto-retry: ${msg}` },
      });
      results.push({ id: b.id, ageMin, action: "failed", error: msg });
    }
  }

  return Response.json({
    ok: true,
    found: stuck.length,
    threshold_min: STUCK_THRESHOLD_MIN,
    results,
  });
};
