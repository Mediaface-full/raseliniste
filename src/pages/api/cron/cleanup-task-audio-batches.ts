import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * POST /api/cron/cleanup-task-audio-batches
 * Auth: x-cron-key
 * Schedule: denně 02:30
 *
 * Audio retention pro task batches:
 *   - Smaže audio z batchů > 7 dní (audio už je k ničemu, transcript zůstává)
 *   - Smaže celé batche committed/discarded > 30 dní (audit retention)
 *   - Stuck > 30 min → error (auto-retry mělo zafungovat dřív, viz retry-stuck-task-batches)
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

  const oldWithAudio = await prisma.taskAudioBatch.findMany({
    where: { audioPath: { not: null }, createdAt: { lt: sevenDaysAgo } },
    select: { id: true, audioPath: true },
  });
  let audioDeleted = 0;
  for (const b of oldWithAudio) {
    if (b.audioPath) {
      await deleteUpload(b.audioPath).catch(() => null);
      await prisma.taskAudioBatch.update({ where: { id: b.id }, data: { audioPath: null } });
      audioDeleted++;
    }
  }

  const purged = await prisma.taskAudioBatch.deleteMany({
    where: {
      status: { in: ["committed", "discarded"] },
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  const finallyError = await prisma.taskAudioBatch.updateMany({
    where: { status: "processing", createdAt: { lt: thirtyMinAgo } },
    data: {
      status: "error",
      processingError: "Auto-error: batch v 'processing' déle než 30 min i po retries. Použij ručně Regenerovat.",
    },
  });

  return Response.json({
    ok: true,
    audioDeleted,
    batchesPurged: purged.count,
    finallyErrored: finallyError.count,
  });
};
