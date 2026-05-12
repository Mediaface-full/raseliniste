import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { embedPendingForUser } from "@/lib/posta-embed";

export const prerender = false;

const BATCH_LIMIT = 50;

/**
 * Pošta — embedding cron (every 5 min).
 *
 * Pro každého usera s Google integrací najde klasifikované unembed maily
 * (max 50/iteraci) a vygeneruje chunks + embeddings.
 *
 * Decoupling od posta-classify per Petrovo zadání fáze 4. Embed je drahá
 * operace (5-10s per email s chunking + Gemini calls), separátní worker
 * šetří overhead klasifikace.
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
    const stats = await embedPendingForUser(i.userId, BATCH_LIMIT);
    results.push({
      userId: i.userId,
      total: stats.total,
      embedded: stats.embedded,
      skipped: stats.skipped,
      failed: stats.failed,
      durationMs: stats.durationMs,
    });
  }

  return Response.json({ ok: true, users: results });
};
