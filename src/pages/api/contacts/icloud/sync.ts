/**
 * POST /api/contacts/icloud/sync
 *
 * Plný pull kontaktů z iCloudu do Rašeliniště DB + auto-merge duplicit po
 * sync (Petr 2026-05-15 — Apple posílá `\r` v UID/jménech, match občas
 * selhal a vznikaly duplicity).
 *
 * Match logika v upsertContact (kontakty_brief.md fáze 1):
 *   1. icloudUid match → re-sync (replace phones/emails)
 *   2. phoneKey (posledních 9 číslic) NEBO email match na VŠECHNY kontakty
 *      (i s icloudUid — Apple může změnit UID mezi syncy) → propojit, zachovat
 *      lokální + iCloud union
 *   3. žádný match → nový Contact
 *
 * Overlay pole (isVip/aliases/clientTag/callLogToken/isTeam/...) se NETÝKAJÍ.
 *
 * Po sync automaticky:
 *   - cleanup `&#13;` entit (idempotent)
 *   - auto-merge duplicit (preferenčně primárka s VIP/clientTag/icloudUid).
 *
 * Rate-limit 30s per user (anti double-click).
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { pullIcloudContacts } from "@/lib/icloud-contacts";
import { findDuplicateClusters, mergeContacts } from "@/lib/contacts-duplicates";
import { prisma } from "@/lib/db";

export const prerender = false;

const lastSyncStarted = new Map<string, number>();
const SYNC_RATE_LIMIT_MS = 30_000;

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const now = Date.now();
  const lastStart = lastSyncStarted.get(session.uid) ?? 0;
  if (now - lastStart < SYNC_RATE_LIMIT_MS) {
    return Response.json({
      ok: false,
      error: `Sync běžel před ${Math.round((now - lastStart) / 1000)} s. Vyčkej alespoň 30 s mezi syncy.`,
    }, { status: 429 });
  }
  lastSyncStarted.set(session.uid, now);

  const stats = await pullIcloudContacts(session.uid);

  if (!stats.ok) {
    return Response.json({ ok: false, stats }, { status: 500 });
  }

  // Auto-merge po sync — pojistka pro případ kdy match strategie selže.
  const autoMergeStats = { merged: 0, clusters: 0 };
  try {
    const clusters = await findDuplicateClusters(session.uid);
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
      const r = await mergeContacts(session.uid, primary.id, secondaries);
      if (r.ok) {
        autoMergeStats.merged += r.mergedCount;
        autoMergeStats.clusters++;
      }
    }
  } catch (e) {
    console.warn("[icloud-sync] auto-merge after sync failed:", e instanceof Error ? e.message : e);
  }

  const finalCount = await prisma.contact.count({ where: { userId: session.uid } });

  return Response.json({
    ok: true,
    stats: { ...stats, autoMerge: autoMergeStats, finalContactCount: finalCount },
  });
};
