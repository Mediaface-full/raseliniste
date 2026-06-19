import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { runBackup } from "@/lib/backup";
import { sendMail } from "@/lib/mailer";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const prerender = false;

// Manuální i cron run promítnout do CronRun aby /start widget
// (SchedulerStatus) odrážel realitu. Bez tohoto manuální GET úspěch
// nezavolá dispatcher → lastError visí dál.
async function recordCronRun(ok: boolean, error: string | null, durationMs: number) {
  const now = new Date();
  await prisma.cronRun.upsert({
    where: { jobName: "backup" },
    update: {
      lastTriggeredAt: now,
      lastSuccessAt: ok ? now : undefined,
      lastError: ok ? null : error,
      lastDurationMs: durationMs,
      lastStatus: ok ? 200 : 500,
      runCount: { increment: 1 },
      successCount: ok ? { increment: 1 } : undefined,
      errorCount: ok ? undefined : { increment: 1 },
    },
    create: {
      jobName: "backup",
      lastTriggeredAt: now,
      lastSuccessAt: ok ? now : null,
      lastError: ok ? null : error,
      lastDurationMs: durationMs,
      lastStatus: ok ? 200 : 500,
      runCount: 1,
      successCount: ok ? 1 : 0,
      errorCount: ok ? 0 : 1,
    },
  });
}

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
  const result = await runBackup({ triggeredBy: "cron" });
  console.log(`[cron-backup] done in ${result.durationMs}ms, ok=${result.ok}`);

  await recordCronRun(result.ok, result.ok ? null : "backup failed", result.durationMs);

  // Mail při fail (info-level success do logu stačí)
  const to = env.NOTIFICATION_EMAIL;
  if (!result.ok && to) {
    const subject = `Rašeliniště — backup selhal`;
    const lines: string[] = [
      `Backup ${result.startedAt} → ${result.finishedAt} (${(result.durationMs / 1000).toFixed(1)}s)`,
      ``,
      `pg_dump:  ${result.steps.pgDump.ok ? "" : "" + (result.steps.pgDump.error ?? "")}`,
      `uploads:  ${result.steps.uploadsTar.ok ? "" : "" + (result.steps.uploadsTar.error ?? "")}`,
      `rsync:    ${result.steps.rsync.ok ? (result.steps.rsync.skipped ? "skipped (remote nenastaven)" : "") : "" + (result.steps.rsync.error ?? "")}`,
      `retention:${result.steps.retention.ok ? `smazáno ${result.steps.retention.deleted}` : "" + (result.steps.retention.error ?? "")}`,
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
 * GET — manuální test endpoint. Auth dvojí cestou:
 *   - Přihlášený admin v browseru (session cookie) — Petr otevře v záložce
 *   - Nebo ?key=<CRON_SECRET> pro skripty/curl bez session
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  const session = await readSession(cookies);
  const secret = env.CRON_SECRET;
  const validKey = secret && url.searchParams.get("key") === secret;

  if (!session && !validKey) {
    return Response.json(
      { error: "UNAUTHORIZED. Buď přihlas se v browseru, nebo použij ?key=<CRON_SECRET>." },
      { status: 401 },
    );
  }

  console.log(`[cron-backup] manual GET trigger (${session ? "session" : "cron-key"})`);
  const result = await runBackup({ triggeredBy: session ? "manual-session" : "manual-key" });
  await recordCronRun(result.ok, result.ok ? null : "backup failed", result.durationMs);
  return Response.json(result, { status: result.ok ? 200 : 500 });
};
