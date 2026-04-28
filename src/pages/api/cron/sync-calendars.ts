import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { syncGoogleCalendar } from "@/lib/google-calendar";
import { syncBothIcloud } from "@/lib/icloud-calendar";

export const prerender = false;

/**
 * POST /api/cron/sync-calendars
 * Auth: x-cron-key
 * Schedule: každých 5 min
 *
 * Synchronizuje Google primary + oba iCloud kalendáře (pokud připojené).
 * Chyba jednoho zdroje neblokuje ostatní.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const integrations = await prisma.userIntegration.findMany({
    where: { provider: { in: ["google", "icloud"] } },
    select: { userId: true, provider: true },
  });

  const byUser = new Map<string, Set<string>>();
  for (const { userId, provider } of integrations) {
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId)!.add(provider);
  }

  const results: Array<{
    userId: string;
    google?: { ok: boolean; result?: unknown; error?: string };
    icloud?: { ok: boolean; result?: unknown; error?: string };
  }> = [];

  for (const [userId, providers] of byUser) {
    const r: { userId: string; google?: { ok: boolean; result?: unknown; error?: string }; icloud?: { ok: boolean; result?: unknown; error?: string } } = { userId };

    if (providers.has("google")) {
      try {
        const result = await syncGoogleCalendar(userId);
        r.google = { ok: true, result };
      } catch (e) {
        r.google = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (providers.has("icloud")) {
      try {
        const result = await syncBothIcloud(userId);
        r.icloud = { ok: true, result };
      } catch (e) {
        r.icloud = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    results.push(r);
  }

  return Response.json({ ok: true, results });
};
