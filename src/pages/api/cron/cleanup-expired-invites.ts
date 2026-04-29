import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const prerender = false;

/**
 * POST /api/cron/cleanup-expired-invites
 * Auth: x-cron-key
 * Schedule: denně 01:00
 *
 * Označí PENDING/VIEWED/RESERVED invity s validUntil < now jako EXPIRED.
 * Neexpiruje CONFIRMED ani CANCELED.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await prisma.bookingInvite.updateMany({
    where: {
      validUntil: { lt: new Date() },
      status: { in: ["PENDING", "VIEWED", "RESERVED"] },
    },
    data: { status: "EXPIRED" },
  });

  return Response.json({ ok: true, expired: result.count });
};
