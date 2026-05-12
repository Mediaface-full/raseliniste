import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { detectCommitmentsForUser } from "@/lib/posta-commitment";

export const prerender = false;

/**
 * Pošta — detector vyšumělých závazků (every 15 min, fáze 6).
 *
 * Pro každého usera s Google integrací spustí LLM scan outbound mailů
 * a vytvoří DetectedCommitment záznamy s confidence routing.
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
    const stats = await detectCommitmentsForUser(i.userId);
    results.push({
      userId: i.userId,
      total: stats.total,
      created: stats.created,
      skippedLowConfidence: stats.skippedLowConfidence,
      errors: stats.errors,
      durationMs: stats.durationMs,
    });
  }

  return Response.json({ ok: true, users: results });
};
