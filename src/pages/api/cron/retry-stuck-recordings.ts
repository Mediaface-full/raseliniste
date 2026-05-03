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
 * Najde recordings ve stavu "processing" starší než 10 min — ty pravděpodobně
 * uvázly při restartu kontejneru uprostřed AI processingu (fire-and-forget
 * Promise umřela). Spustí processing znovu z uloženého audia.
 *
 * Bezpečné — pokud je kontejner uvnitř právě skutečně processing (pomalý
 * brief), 10 min stačí na to aby Stage 1 doběhl. Reálná doba processing
 * pro 90 min audio je 2-5 min.
 */
const STUCK_THRESHOLD_MIN = 10;
const MAX_RETRIES_PER_RUN = 5;

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000);

  const stuck = await prisma.projectRecording.findMany({
    where: {
      status: "processing",
      createdAt: { lt: cutoff },
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
