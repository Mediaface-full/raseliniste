import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { buildKolegyneDigest } from "@/lib/planning-digest";

export const prerender = false;

/**
 * Denní digest pro kolegyni (ADHD F4). Dispatcher volá denně 7:00;
 * endpoint no-opne o víkendu a když je digest vypnutý.
 *
 * ?dry=1 → vrátí obsah bez odeslání (testování/preview přes curl).
 * Curl: curl -X POST ".../api/cron/kolegyne-digest" -H "x-cron-key: <CRON_SECRET>"
 */
export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const dry = url.searchParams.get("dry") === "1";

  const day = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Prague" });
  if (!dry && (day === "Sat" || day === "Sun")) return Response.json({ ok: true, skipped: "weekend" });

  const settings = await prisma.planningSettings.findFirst({
    include: { digestContact: { include: { emails: true } } },
  });
  if (!settings?.digestEnabled || !settings.digestContact) {
    return Response.json({ ok: true, skipped: "disabled" });
  }
  const email = settings.digestContact.emails[0]?.email;
  if (!email) return Response.json({ ok: false, error: "Kontakt nemá e-mail." }, { status: 400 });

  const digest = await buildKolegyneDigest(settings.userId, settings.digestContact.id);
  if (digest.isEmpty && !dry) {
    // Prázdný den — neposílat spam "nic se neděje"
    return Response.json({ ok: true, skipped: "empty" });
  }

  if (dry) return Response.json({ ok: true, dry: true, to: email, ...digest });

  const result = await sendMail({
    to: email,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
    context: "kolegyne-digest",
  });
  return Response.json({ ok: result.ok, to: email, error: result.ok ? undefined : result.error });
};
