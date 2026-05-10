import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const prerender = false;

/**
 * GoSMS — denní cleanup SmsMessage starších 90 dní.
 *
 * Maže:
 *   - SmsMessage createdAt < now - 90d
 *   - WHERE isPinned = false
 * Cascade smaže související SmsReply (FK SetNull → ne, ale my smažeme replies
 *   předem aby zůstal čistý audit; reply na pinned zprávu zůstává.)
 *
 * Volaný dispatcherem (cron-schedule.ts) přes /api/cron/scheduler v 03:30.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Najdi staré ne-pinned zprávy
  const oldMessages = await prisma.smsMessage.findMany({
    where: { createdAt: { lt: cutoff }, isPinned: false },
    select: { id: true },
  });
  const ids = oldMessages.map((m) => m.id);

  if (ids.length === 0) {
    return Response.json({ ok: true, deleted: 0 });
  }

  // Smaž odpovědi vázané na tyto zprávy
  const repliesDeleted = await prisma.smsReply.deleteMany({
    where: { smsMessageId: { in: ids } },
  });

  // Smaž samotné zprávy
  const messagesDeleted = await prisma.smsMessage.deleteMany({
    where: { id: { in: ids } },
  });

  // Bonus: smaž osamělé reply starší 90 dnů (např. nesparovaná reply)
  const orphanedRepliesDeleted = await prisma.smsReply.deleteMany({
    where: { receivedAt: { lt: cutoff }, smsMessageId: null },
  });

  return Response.json({
    ok: true,
    deletedMessages: messagesDeleted.count,
    deletedReplies: repliesDeleted.count + orphanedRepliesDeleted.count,
  });
};
