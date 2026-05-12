import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { syncPostaForUser } from "@/lib/posta-sync";

export const prerender = false;

/**
 * POST /api/integrations/google/posta-init
 *
 * Manuální spuštění Pošta sync pro přihlášeného uživatele. Stejná logika
 * jako cron (každých 15 min), ale on-demand pro první import.
 *
 * Hranice fáze 1: max 100 mailů z posledních 7 dnů.
 * Po dokončení vrátí statistiky (imported/skipped/errors) pro UI feedback.
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const stats = await syncPostaForUser(session.uid);

  if (!stats.ok) {
    return Response.json(
      { ok: false, error: stats.error ?? "Sync selhal.", stats },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    stats: {
      mode: stats.mode,
      imported: stats.imported,
      skipped: stats.skipped,
      errors: stats.errors,
      errorDetails: stats.errorDetails.slice(0, 10), // max 10 v UI
      durationMs: stats.durationMs,
      emailAddress: stats.emailAddress,
      historyId: stats.historyIdAfter,
    },
  });
};
