import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { startWatch } from "@/lib/gmail-watch";

export const prerender = false;

/**
 * Pošta — Gmail watch renewal cron (daily 04:00).
 *
 * Gmail watch má max lifetime 7 dnů. Pro bezpečnost obnovujeme každý den
 * pokud expirace je < 48h. (Petr ve specu zmínil "každých 5 dní" — náš
 * daily cron s 48h thresholdem dává ekvivalentní výsledek bez nutnosti
 * týdenního schedulingu.)
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const renewThreshold = new Date(Date.now() + 48 * 60 * 60 * 1000); // < 48h do expirace

  const candidates = await prisma.user.findMany({
    where: {
      gmailWatchTopicName: { not: null },
      OR: [
        { gmailWatchExpiresAt: null },
        { gmailWatchExpiresAt: { lt: renewThreshold } },
      ],
    },
    select: { id: true, gmailWatchExpiresAt: true },
  });

  const results = [];
  for (const u of candidates) {
    try {
      const r = await startWatch(u.id);
      results.push({
        userId: u.id,
        ok: true,
        expiresAt: new Date(r.expirationMs).toISOString(),
        oldExpiresAt: u.gmailWatchExpiresAt?.toISOString() ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ userId: u.id, ok: false, error: msg.slice(0, 300) });
      console.warn(`[posta-watch-renew] userId=${u.id} FAILED: ${msg.slice(0, 300)}`);
    }
  }

  return Response.json({ ok: true, renewed: results.length, results });
};
