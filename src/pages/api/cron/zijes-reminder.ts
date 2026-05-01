import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { sendWhatsAppToUser } from "@/lib/whatsapp";
import { sendPushToUser } from "@/lib/webpush";

export const prerender = false;

/**
 * ŽIJEŠ? — připomínka check-inu.
 *
 * Cron běží 2× denně (DSM Task Scheduler):
 *   - 13:00 → ?type=lunch
 *   - 18:00 → ?type=evening
 *
 * Tón je NEUTRÁLNÍ — žádné "MUSÍŠ vyplnit", žádné streaks, žádné penalizace.
 * Pokud Petr nevyplní, stane se nic. Záměrně bez retry / opakování.
 *
 * Curl:
 *   curl -X POST "https://www.raseliniste.cz/api/cron/zijes-reminder?type=lunch" \
 *        -H "x-cron-key: <CRON_SECRET>"
 */

const BASE_URL = "https://www.raseliniste.cz";

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const typeParam = url.searchParams.get("type");
  const type: "lunch" | "evening" =
    typeParam === "lunch" || typeParam === "evening" ? typeParam : "lunch";

  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, notificationEmail: true, whatsappNumber: true,
      _count: { select: { pushSubscriptions: true } },
    },
  });

  const link = `${BASE_URL}/zijes/novy?type=${type}`;
  const isLunch = type === "lunch";
  const subject = isLunch
    ? "ŽIJEŠ? · polední check-in"
    : "ŽIJEŠ? · večerní check-in";

  // Tón: neutrální, „Tady jsem, když chceš". Žádné urgence.
  const introBody = isLunch
    ? "Polední pauza — 90 sekund kontaktu se sebou."
    : "Konec pracovního dne — 90 sekund kontaktu se sebou.";
  const closing = "Tady jsem, když chceš. Nemusíš.";

  const results: Array<{ user: string; push: number; email: boolean; whatsapp: boolean; reason?: string }> = [];

  for (const user of users) {
    let pushSent = 0;
    let emailOk = false;
    let waOk = false;
    const hasPush = user._count.pushSubscriptions > 0;

    // 1) Web push — primární kanál (pokud má aspoň jednu subscription)
    if (hasPush) {
      const r = await sendPushToUser(user.id, {
        title: subject,
        body: `${introBody}  ${closing}`,
        url: link,
        tag: `zijes-${type}`,
      });
      pushSent = r.sent;
    }

    // 2) Email — vždy pokud má notificationEmail (záloha + audit)
    const emailTo = user.notificationEmail ?? env.NOTIFICATION_EMAIL;
    if (emailTo) {
      const html = renderHtml({ intro: introBody, link, closing, label: subject });
      const text = `${introBody}\n\n${link}\n\n${closing}`;
      const r = await sendMail({ to: emailTo, subject, html, text });
      emailOk = r.ok;
    }

    // 3) WhatsApp — JEN pokud nemá web push (Petr explicitně chtěl push místo WA na mobilu)
    if (user.whatsappNumber && !hasPush) {
      const body = `*${subject}*\n\n${introBody}\n\n${link}\n\n_${closing}_`;
      const r = await sendWhatsAppToUser(user.id, body);
      waOk = r.ok;
      if (!r.ok) {
        results.push({ user: user.username, push: pushSent, email: emailOk, whatsapp: false, reason: r.error });
        continue;
      }
    }

    results.push({ user: user.username, push: pushSent, email: emailOk, whatsapp: waOk });
  }

  return Response.json({ ok: true, type, processed: results });
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(args: { intro: string; link: string; closing: string; label: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1714;color:#e8e3d9;font-family:-apple-system,BlinkMacSystemFont,'Geist','Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#f4a4c7;font-family:ui-monospace,monospace;margin-bottom:8px;">
      ${escapeHtml(args.label)}
    </div>
    <p style="font-size:16px;line-height:1.6;color:#e8e3d9;margin:0 0 24px;">
      ${escapeHtml(args.intro)}
    </p>
    <a href="${args.link}" style="display:inline-block;padding:12px 20px;background:rgba(244,164,199,0.2);border:1px solid rgba(244,164,199,0.4);border-radius:8px;color:#fff;text-decoration:none;font-size:15px;">
      Otevřít check-in →
    </a>
    <p style="font-size:13px;color:#9a8f82;margin:28px 0 0;font-style:italic;">
      ${escapeHtml(args.closing)}
    </p>
  </div>
</body>
</html>`;
}
