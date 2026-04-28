import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncGoogleCalendar } from "@/lib/google-calendar";

export const prerender = false;

/**
 * POST /api/cron/sync-calendars
 * Auth: x-cron-key
 * Schedule: každých 5 min (cron: minutes star slash 5)
 *
 * Jen Google primary v této fázi (1a). iCloud v 1b.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Pro single-user systém najdi všechny usery s google integrací
  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "google" },
    select: { userId: true },
  });

  const results: Array<{
    userId: string;
    google?: { ok: boolean; result?: unknown; error?: string };
  }> = [];

  for (const { userId } of integrations) {
    const r: { userId: string; google?: { ok: boolean; result?: unknown; error?: string } } = { userId };
    try {
      const result = await syncGoogleCalendar(userId);
      r.google = { ok: true, result };
    } catch (e) {
      r.google = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    results.push(r);
  }

  return Response.json({ ok: true, results });
};
