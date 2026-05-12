import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { generateDigestForUser } from "@/lib/posta-digest";

export const prerender = false;

/**
 * Pošta — digest cron (denně 7:00).
 *
 * Pro každého usera s Google integrací generuje denní EmailDigest snapshot.
 * Idempotentní — pokud už existuje digest pro dnešek, no-op (force: false).
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
    const stats = await generateDigestForUser(i.userId);
    results.push({
      userId: i.userId,
      ok: stats.ok,
      reused: stats.reused ?? false,
      totalActiveEmails: stats.totalActiveEmails,
      durationMs: stats.durationMs,
      error: stats.error,
    });
  }

  return Response.json({ ok: true, users: results });
};
