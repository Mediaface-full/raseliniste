/**
 * Cron `posta-backfill` — 15min tick zpetneho importu historie Gmailu.
 *
 * Volá `backfillMetadataTick` pro vsechny usery kde `gmailBackfillStartedAt`
 * is set a `gmailBackfillCompletedAt` is null. Single tick = jedna page (500
 * mailu) + metadata-only fetch per mail.
 *
 * Po dokonceni (no more pages) se sam vypne — nastavi completedAt + stop.
 */

import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { backfillMetadataTick } from "@/lib/posta-sync";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Auth: x-cron-key header
  const key = request.headers.get("x-cron-key");
  if (key !== env.CRON_SECRET) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const usersToBackfill = await prisma.user.findMany({
    where: {
      gmailBackfillStartedAt: { not: null },
      gmailBackfillCompletedAt: null,
    },
    select: { id: true },
  });

  if (usersToBackfill.length === 0) {
    return Response.json({ ok: true, message: "Žádný backfill neběží.", users: 0 });
  }

  const results = [];
  for (const u of usersToBackfill) {
    const stats = await backfillMetadataTick(u.id);
    results.push(stats);
  }

  return Response.json({
    ok: true,
    users: usersToBackfill.length,
    results: results.map((r) => ({
      userId: r.userId,
      ok: r.ok,
      fetched: r.fetched,
      skipped: r.skipped,
      errors: r.errors,
      totalSoFar: r.totalSoFar,
      hasMore: r.hasMore,
      durationMs: r.durationMs,
      error: r.error,
    })),
  });
};
