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
 * Dvě úlohy:
 * 1) Smaž audio z batchů, kterým je víc než 7 dní (i z review co Petr nikdy
 *    nedořešil — audio už nebudeme potřebovat).
 * 2) Smaž záznamy committed/discarded batchů starší 30 dní (audit retention).
 *
 * Také: pokud je batch v "processing" déle než 30 min (= mrtvý fire-and-forget
 * po restartu), retry jednou nebo error-out.
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

  // 1) Smaž audio z batchů starších 7 dní (kterékoliv status — review co
  //    Petr neudělal, error, ...). Audio retention 7 dní.
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

  // 2) Smaž celé batche committed/discarded starší 30 dní
  const purged = await prisma.taskAudioBatch.deleteMany({
    where: {
      status: { in: ["committed", "discarded"] },
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  // 3) Stuck processing > 30 min → označ error
  const stuck = await prisma.taskAudioBatch.updateMany({
    where: { status: "processing", createdAt: { lt: thirtyMinAgo } },
    data: {
      status: "error",
      processingError: "Auto-error: batch zůstal v 'processing' déle než 30 min (kontejner zřejmě restartoval). Použij Regenerovat.",
    },
  });

  return Response.json({
    ok: true,
    audioDeleted,
    batchesPurged: purged.count,
    stuckMarked: stuck.count,
  });
};
