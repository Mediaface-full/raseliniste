import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteUpload } from "@/lib/uploads";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processJournalAudio } from "@/lib/process-journal-audio";

export const prerender = false;

/**
 * POST /api/cron/cleanup-journal-audio
 * Auth: x-cron-key
 * Schedule: denně 03:15
 *
 * Audio retention pro deníkové zápisy:
 *   - Smaže audio z entries starších 7 dní (s audioRetainForever=false)
 *   - Stuck "processing" > 5 min → auto-retry (fire-and-forget Promise GC ochrana)
 *   - Stuck "processing" > 30 min → finally error
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

  // 1) Audio retention
  const oldWithAudio = await prisma.journalEntry.findMany({
    where: {
      audioPath: { not: null },
      audioRetainForever: false,
      createdAt: { lt: sevenDaysAgo },
    },
    select: { id: true, audioPath: true },
  });
  let audioDeleted = 0;
  for (const e of oldWithAudio) {
    if (e.audioPath) {
      await deleteUpload(e.audioPath).catch(() => null);
      await prisma.journalEntry.update({
        where: { id: e.id },
        data: { audioPath: null, audioBytes: null, audioMime: null, audioDeletedAt: now },
      });
      audioDeleted++;
    }
  }

  // 2) Auto-retry stuck > 5 min
  const stuck = await prisma.journalEntry.findMany({
    where: { status: "processing", createdAt: { lt: fiveMinAgo, gte: thirtyMinAgo } },
    take: 5,
  });
  let retried = 0;
  for (const e of stuck) {
    if (!e.audioPath || !(await uploadExists(e.audioPath))) continue;
    try {
      const audio = await readUpload(e.audioPath);
      void processJournalAudio({
        entryId: e.id,
        audio,
        mimeType: e.audioMime ?? "audio/webm",
      });
      retried++;
    } catch (err) {
      await prisma.journalEntry
        .update({
          where: { id: e.id },
          data: { status: "error", processingError: `Auto-retry: ${err instanceof Error ? err.message : String(err)}` },
        })
        .catch(() => null);
    }
  }

  // 3) Finally error stuck > 30 min
  const finallyError = await prisma.journalEntry.updateMany({
    where: { status: "processing", createdAt: { lt: thirtyMinAgo } },
    data: {
      status: "error",
      processingError: "Auto-error: zápis v 'processing' déle než 30 min i po retries.",
    },
  });

  return Response.json({
    ok: true,
    audioDeleted,
    stuckRetried: retried,
    finallyErrored: finallyError.count,
  });
};
