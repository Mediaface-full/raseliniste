import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncGooglePeople } from "@/lib/google-people";

export const prerender = false;

/**
 * POST /api/cron/sync-contacts
 * Auth: x-cron-key
 * Schedule: 0 4 * * * (denně 04:00)
 *
 * Sync Google kontaktů přes People API. Read-only, dedup podle
 * googleResourceName / email / phone.
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

  const results: Array<{ userId: string; ok: boolean; result?: unknown; error?: string }> = [];

  for (const { userId } of integrations) {
    try {
      const result = await syncGooglePeople(userId);
      results.push({ userId, ok: true, result });
    } catch (e) {
      results.push({ userId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ ok: true, results });
};
