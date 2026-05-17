import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { runBackup } from "@/lib/backup";
import { sendMail } from "@/lib/mailer";

export const prerender = false;

/**
 * POST /api/cron/backup
 *
 * Volá dispatcher z /api/cron/scheduler 1× denně (cron-schedule.ts entry).
 * Vrátí JSON s výsledkem všech 4 kroků. Pokud něco selže, pošle mail.
 *
 * Manuální spuštění z DSM nebo Bash:
 *   curl -X POST https://www.raseliniste.cz/api/cron/backup \
 *        -H "x-cron-key: <CRON_SECRET>"
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  console.log("[cron-backup] start");
  const result = await runBackup();
  console.log(`[cron-backup] done in ${result.durationMs}ms, ok=${result.ok}`);

  // Mail při fail (info-level success do logu stačí)
  const to = env.NOTIFICATION_EMAIL;
  if (!result.ok && to) {
    const subject = `⚠️ Rašeliniště — backup selhal`;
    const lines: string[] = [
      `Backup ${result.startedAt} → ${result.finishedAt} (${(result.durationMs / 1000).toFixed(1)}s)`,
      ``,
      `pg_dump:  ${result.steps.pgDump.ok ? "✓" : "✗ " + (result.steps.pgDump.error ?? "")}`,
      `uploads:  ${result.steps.uploadsTar.ok ? "✓" : "✗ " + (result.steps.uploadsTar.error ?? "")}`,
      `rsync:    ${result.steps.rsync.ok ? (result.steps.rsync.skipped ? "skipped (remote nenastaven)" : "✓") : "✗ " + (result.steps.rsync.error ?? "")}`,
      `retention:${result.steps.retention.ok ? `✓ smazáno ${result.steps.retention.deleted}` : "✗ " + (result.steps.retention.error ?? "")}`,
    ];
    await sendMail({
      to,
      subject,
      text: lines.join("\n"),
      html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;">${lines.join("\n")}</pre>`,
    });
  }

  return Response.json(result, { status: result.ok ? 200 : 500 });
};

/**
 * GET — manuální test endpoint (auth jen přes session, ne cron-key).
 * Pro Petra: otevřít /api/cron/backup v browseru přihlášený nebo
 * `curl -X GET https://.../api/cron/backup?key=<CRON_SECRET>`.
 */
export const GET: APIRoute = async ({ url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (url.searchParams.get("key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED. Použij ?key=<CRON_SECRET>" }, { status: 401 });
  }

  console.log("[cron-backup] manual GET trigger");
  const result = await runBackup();
  return Response.json(result, { status: result.ok ? 200 : 500 });
};
