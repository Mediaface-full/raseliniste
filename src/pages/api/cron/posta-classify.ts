import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { classifyPendingForUser } from "@/lib/posta-classify";

export const prerender = false;

const CLASSIFY_BATCH_LIMIT = 50;

/**
 * Pošta — klasifikační cron (každých 15 min, posunutý o 5 min od posta-sync
 * aby nešly zároveň).
 *
 * Pro každého usera s `UserIntegration(provider="google")` projde unclassified
 * EmailMessage záznamy (max 50/iteraci) a pošle Gemini Flash.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "google" },
    select: { userId: true },
  });

  const results = [];
  for (const i of integrations) {
    const stats = await classifyPendingForUser(i.userId, CLASSIFY_BATCH_LIMIT);
    results.push({
      userId: i.userId,
      total: stats.total,
      classified: stats.classified,
      skipped: stats.skipped,
      errors: stats.errors,
      durationMs: stats.durationMs,
    });
  }

  return Response.json({ ok: true, users: results });
};
