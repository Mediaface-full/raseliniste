import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { syncPostaForUser } from "@/lib/posta-sync";
import { prisma } from "@/lib/db";

export const prerender = false;

/**
 * POST /api/integrations/google/posta-init
 *
 * Manuální spuštění Pošta sync pro přihlášeného uživatele. Stejná logika
 * jako cron (každých 15 min), ale on-demand pro první import.
 *
 * Query parametr `?reinit=1` resetuje gmailHistoryId na NULL pred syncem —
 * dalsi sync pojede v INIT mode (96d pull, max 5000 mailu) misto incremental
 * (1d pull, max 200 mailu). Pouziti: kdyz prvni import dosel jen na 7d/100
 * mailu (dev test limit), Petr potrebuje re-trigger full backfill.
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Reinit: vynuluj gmailHistoryId → další sync pojede init režimem
  const reinit = url.searchParams.get("reinit") === "1";
  if (reinit) {
    await prisma.user.update({
      where: { id: session.uid },
      data: { gmailHistoryId: null, gmailSyncError: null },
    });
  }

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
