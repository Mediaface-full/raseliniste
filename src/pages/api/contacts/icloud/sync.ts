/**
 * POST /api/contacts/icloud/sync
 *
 * Plný pull kontaktů z iCloudu do Rašeliniště DB.
 * Match logika (kontakty_brief.md fáze 1 + Petrovo rozhodnutí 2026-05-14):
 *   1. icloudUid match → re-sync (replace phones/emails)
 *   2. phone/email exact match → first match (union, zachovat lokální)
 *   3. žádný match → nový Contact
 *
 * Overlay pole (isVip/aliases/clientTag/callLogToken/isTeam/...) se NETÝKAJÍ —
 * iCloud o nich neví, sync je nepřepisuje.
 *
 * Vrátí SyncStats: {ok, pulled, created, updated, matched, groups, errors, durationMs}.
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { pullIcloudContacts } from "@/lib/icloud-contacts";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const stats = await pullIcloudContacts(session.uid);

  if (!stats.ok) {
    return Response.json({ ok: false, stats }, { status: 500 });
  }
  return Response.json({ ok: true, stats });
};
