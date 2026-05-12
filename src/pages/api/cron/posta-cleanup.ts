import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { runRetentionCleanup } from "@/lib/posta-cleanup";

export const prerender = false;

/**
 * Pošta — 96denní retention cleanup (denně 03:00).
 *
 * Volá `runRetentionCleanup` který smyčkuje batche 1000 mailů a nuluje
 * bodyText/bodyHtml/attachments/rawHeaders u mailů starších než 96 dnů.
 * Idempotent (skip podle bodyDeletedAt IS NULL).
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const stats = await runRetentionCleanup();
  return Response.json({ ok: true, stats });
};
