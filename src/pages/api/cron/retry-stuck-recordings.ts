import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processRecording } from "@/lib/process-recording";

export const prerender = false;

/**
 * POST /api/cron/retry-stuck-recordings
 * Auth: x-cron-key
 * Schedule: každých 15 min
 *
 * Chytá DVA případy:
 *  1) status="processing" starší 10 min — uvázly při restartu kontejneru,
 *     fire-and-forget Promise umřela
 *  2) status="error" mladší než MAX_AGE_FOR_ERROR_RETRY — Gemini timeout,
 *     JSON parse selhal, etc. Reálné erory automaticky retry-ujeme jednou
 *     za hodinu (cron 15 min × ERROR_RETRY_INTERVAL_MIN), ale max do 24 h
 *     stáří, pak je necháme být (skutečně rozbitý záznam).
 *
 * Spustí processing znovu z uloženého audia.
 */
const STUCK_THRESHOLD_MIN = 10;
const ERROR_RETRY_INTERVAL_MIN = 60;        // retry erroru max 1× za hodinu
const ERROR_MAX_AGE_HOURS = 24;             // po 24 h už neretry-ujeme
const MAX_RETRIES_PER_RUN = 8;

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = Date.now();
  const stuckCutoff = new Date(now - STUCK_THRESHOLD_MIN * 60 * 1000);
  const errorRetryCutoff = new Date(now - ERROR_RETRY_INTERVAL_MIN * 60 * 1000);
  const errorMaxAge = new Date(now - ERROR_MAX_AGE_HOURS * 60 * 60 * 1000);

  const stuck = await prisma.projectRecording.findMany({
    where: {
      OR: [
        // Případ 1: processing > 10 min
        { status: "processing", createdAt: { lt: stuckCutoff } },
        // Případ 2: error mladší 24 h, neaktualizovaný posledních 60 min
        // (`updatedAt` se updatuje při každém update, takže poslední retry pokus
        // se přepne sem. 60 min cooldown brání busy-loop kdy Gemini stále padá.)
        { status: "error", createdAt: { gt: errorMaxAge }, updatedAt: { lt: errorRetryCutoff } },
      ],
    },
    include: {
      project: { select: { description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true } },
    },
    take: MAX_RETRIES_PER_RUN,
    orderBy: { createdAt: "asc" },
  });

  const results: Array<{
    id: string;
    ageMinutes: number;
    action: "retried" | "skipped_no_audio" | "failed";
    error?: string;
  }> = [];

  for (const r of stuck) {
    const ageMin = Math.round((Date.now() - r.createdAt.getTime()) / 60000);

    if (!r.audioPath || !(await uploadExists(r.audioPath))) {
      // Audio už neexistuje (cleanup cron mezitím smazal), označíme jako error
      await prisma.projectRecording.update({
        where: { id: r.id },
        data: {
          status: "error",
          processingError: "Recording uvázl v 'processing' a audio už není na disku — nelze obnovit.",
        },
      });
      results.push({ id: r.id, ageMinutes: ageMin, action: "skipped_no_audio" });
      continue;
    }

    try {
      const audio = await readUpload(r.audioPath);
      // Reset stavu na processing — bumpne updatedAt, takže nový error retry
      // přijde nejdřív za ERROR_RETRY_INTERVAL_MIN. UI ukáže loader.
      await prisma.projectRecording.update({
        where: { id: r.id },
        data: { status: "processing", processingError: null },
      });
      // Fire-and-forget — vyhodnotí se na pozadí, cron neblokujeme
      void processRecording({
        recordingId: r.id,
        audio,
        mimeType: r.audioMime ?? "audio/webm",
        type: r.type as "STANDARD" | "BRIEF",
        projectContext: r.project.description,
        customStandardPrompt: r.project.studnaStandardPrompt,
        customBriefPrompt: r.project.studnaBriefPrompt,
        analysisModel: r.project.analysisModel,
      });
      results.push({ id: r.id, ageMinutes: ageMin, action: "retried" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.projectRecording.update({
        where: { id: r.id },
        data: { status: "error", processingError: `Auto-retry selhal při čtení audio: ${msg}` },
      });
      results.push({ id: r.id, ageMinutes: ageMin, action: "failed", error: msg });
    }
  }

  return Response.json({
    ok: true,
    found: stuck.length,
    threshold_min: STUCK_THRESHOLD_MIN,
    results,
  });
};
