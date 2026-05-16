/**
 * GET /api/contacts/sync-progress
 *
 * Frontend polluje à 2s pokud syncing — vrací aktuální progress (stage,
 * current/total/merged) pro UI banner.
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { getSyncProgress } from "@/lib/contacts-sync-progress";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const progress = await getSyncProgress(session.uid);
  return Response.json({ ok: true, progress });
};
