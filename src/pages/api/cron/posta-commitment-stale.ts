import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { markStaleCommitments } from "@/lib/posta-commitment-sync";

export const prerender = false;

/**
 * Pošta — stale marker (daily 03:00, fáze 6).
 *
 * Najde active commitmenty s lastActionAt < 30 dnů a označí status="stale".
 * Po stale → cron `posta-commitment-todoist-sync` zpracuje (přidá label).
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await markStaleCommitments();
  return Response.json({ ok: true, ...result });
};
