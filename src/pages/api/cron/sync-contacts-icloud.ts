import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { pullIcloudContacts } from "@/lib/icloud-contacts";
import { findDuplicateClusters, mergeContacts } from "@/lib/contacts-duplicates";

export const prerender = false;

/**
 * POST /api/cron/sync-contacts-icloud  (Petr 2026-05-24)
 * Auth: x-cron-key
 * Schedule: každých 30 min (viz cron-schedule.ts)
 *
 * Pull kontaktů z iCloudu pro každého uživatele, který má provider="icloud"
 * integraci. Read-only z pohledu Apple (CardDAV PROPFIND/GET, žádný PUT).
 *
 * Po pullu spustí auto-merge duplicit (pojistka pro případy, kdy Apple
 * přerotuje UID — viz icloud/sync.ts manual endpoint).
 *
 * Vznikl protože Petr 2026-05-24 nahlásil, že úprava kontaktu na mobilu
 * se nepropíše do /contacts (UI v Rašeliništi). Dosud běžel jen
 * `sync-contacts` cron pro Google People (4:00), iCloud byl pure-manual
 * (tlačítko "Obnovit" v /contacts).
 *
 * Push (Rašeliniště → iCloud) zůstává manuální — tady jen pull.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const integrations = await prisma.userIntegration.findMany({
    where: { provider: "icloud" },
    select: { userId: true },
  });

  const results: Array<{
    userId: string;
    ok: boolean;
    pulled?: number;
    created?: number;
    matched?: number;
    mergedClusters?: number;
    mergedContacts?: number;
    error?: string;
  }> = [];

  for (const { userId } of integrations) {
    try {
      const stats = await pullIcloudContacts(userId);
      if (!stats.ok) {
        results.push({ userId, ok: false, error: stats.error ?? "pull failed" });
        continue;
      }

      // Auto-merge duplicit (stejný pattern jako manual endpoint)
      let mergedClusters = 0;
      let mergedContacts = 0;
      try {
        const clusters = await findDuplicateClusters(userId);
        for (const cluster of clusters) {
          const sorted = cluster.contacts.slice().sort((a, b) => {
            const pa = (a.isVip ? 100 : 0) + (a.clientTag ? 30 : 0) + (a.icloudUid ? 10 : 0);
            const pb = (b.isVip ? 100 : 0) + (b.clientTag ? 30 : 0) + (b.icloudUid ? 10 : 0);
            if (pa !== pb) return pb - pa;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });
          const primary = sorted[0];
          const secondaries = sorted.slice(1).map((c) => c.id);
          if (secondaries.length === 0) continue;
          const r = await mergeContacts(userId, primary.id, secondaries);
          if (r.ok) {
            mergedContacts += r.mergedCount;
            mergedClusters++;
          }
        }
      } catch (e) {
        console.warn("[cron.sync-contacts-icloud] auto-merge failed:", e instanceof Error ? e.message : e);
      }

      results.push({
        userId,
        ok: true,
        pulled: stats.pulled,
        created: stats.created,
        matched: stats.matched,
        mergedClusters,
        mergedContacts,
      });
    } catch (e) {
      results.push({ userId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ ok: true, results });
};
