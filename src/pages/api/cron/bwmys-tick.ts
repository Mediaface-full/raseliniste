import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { sendPushToUser } from "@/lib/webpush";

export const prerender = false;

/**
 * Myši denní tick (cron 7:10 ráno).
 *
 * Co dělá:
 *   1. Odložená rozhodnutí kde odlozenoDo <= dnes → vrátí na status=aktivni
 *   2. Aktivní rozhodnutí kde deadline za 3 dny → email/push notifikace
 *   3. Aktivní rozhodnutí kde sběr (datumVytvoreni + delkaSberuDny) uplynul → notifikace
 *   4. Uzavřená rozhodnutí kde datumRevize <= dnes → notifikace „čas zkontrolovat"
 *
 * Tón: věcný, NE terapeutický (PDF specifikace zakazuje).
 */

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in3Days = new Date(todayStart.getTime() + 3 * 86400000);

  // 1. Auto-návrat odložených
  const reopened = await prisma.decision.updateMany({
    where: {
      status: "odlozene",
      odlozenoDo: { lte: now },
    },
    data: { status: "aktivni", odlozenoDo: null },
  });

  // 2-4. Notifikace per user
  const users = await prisma.user.findMany({
    select: { id: true, username: true, notificationEmail: true, _count: { select: { pushSubscriptions: true } } },
  });

  type Notif = { kind: "deadline_approaching" | "sber_uplynul" | "revize_dnes" | "auto_aktivni"; nazev: string; id: string; days?: number };
  const results: Array<{ user: string; notifs: number }> = [];

  for (const user of users) {
    const notifs: Notif[] = [];

    // 2. Deadline za 3 dny
    const approaching = await prisma.decision.findMany({
      where: {
        userId: user.id,
        status: "aktivni",
        deadlineRozhodnuti: { gt: now, lte: in3Days },
      },
      select: { id: true, nazev: true, deadlineRozhodnuti: true },
    });
    approaching.forEach((d) => {
      const days = Math.ceil((d.deadlineRozhodnuti.getTime() - now.getTime()) / 86400000);
      notifs.push({ kind: "deadline_approaching", nazev: d.nazev, id: d.id, days });
    });

    // 3. Sběr uplynul (datumVytvoreni + delkaSberuDny < dnes a stav aktivni)
    const aktivni = await prisma.decision.findMany({
      where: { userId: user.id, status: "aktivni" },
      select: { id: true, nazev: true, datumVytvoreni: true, delkaSberuDny: true },
    });
    aktivni.forEach((d) => {
      const sberKonec = new Date(d.datumVytvoreni.getTime() + d.delkaSberuDny * 86400000);
      // Notifikuj přesně v den uplynutí (sberKonec >= dnes 00:00 a < dnes 23:59)
      if (sberKonec >= todayStart && sberKonec < new Date(todayStart.getTime() + 86400000)) {
        notifs.push({ kind: "sber_uplynul", nazev: d.nazev, id: d.id });
      }
    });

    // 4. Revize dnes
    const revize = await prisma.decision.findMany({
      where: {
        userId: user.id,
        status: { in: ["uzavrene_jdu", "uzavrene_nejdu"] },
        datumRevize: { gte: todayStart, lt: new Date(todayStart.getTime() + 86400000) },
      },
      select: { id: true, nazev: true },
    });
    revize.forEach((d) => notifs.push({ kind: "revize_dnes", nazev: d.nazev, id: d.id }));

    if (notifs.length === 0) {
      results.push({ user: user.username, notifs: 0 });
      continue;
    }

    // Pošli (email + push)
    const subject = `Myši — ${notifs.length} ${notifs.length === 1 ? "připomínka" : "připomínek"}`;
    const html = renderHtml(notifs);
    const text = notifs.map((n) => `${kindLabel(n)}: ${n.nazev}`).join("\n");

    const emailTo = user.notificationEmail ?? env.NOTIFICATION_EMAIL;
    if (emailTo) {
      await sendMail({ to: emailTo, subject, html, text });
    }
    if (user._count.pushSubscriptions > 0) {
      await sendPushToUser(user.id, {
        title: subject,
        body: notifs.map((n) => `${kindLabel(n)}: ${n.nazev}`).slice(0, 3).join("  "),
        url: notifs.length === 1 ? `/bwmys/${notifs[0].id}` : "/bwmys",
        tag: "bwmys-tick",
      });
    }

    results.push({ user: user.username, notifs: notifs.length });
  }

  return Response.json({ ok: true, reopened: reopened.count, processed: results });
};

function kindLabel(n: { kind: string; days?: number }): string {
  switch (n.kind) {
    case "deadline_approaching": return `Deadline za ${n.days}d`;
    case "sber_uplynul": return "Sběr uplynul, zvaž finální vyhodnocení";
    case "revize_dnes": return "Datum revize uzavřeného rozhodnutí";
    case "auto_aktivni": return "Odložené rozhodnutí se vrátilo do aktivních";
    default: return n.kind;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(notifs: Array<{ kind: string; nazev: string; id: string; days?: number }>): string {
  const baseUrl = "https://www.raseliniste.cz";
  const items = notifs.map((n) => `
    <div style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:8px;background:#241f1b;">
      <div style="font-size:11px;color:#9a8f82;font-family:ui-monospace,monospace;">${escapeHtml(kindLabel(n))}</div>
      <a href="${baseUrl}/bwmys/${n.id}" style="font-size:15px;color:#fff;text-decoration:none;">${escapeHtml(n.nazev)}</a>
    </div>
  `).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#1a1714;color:#e8e3d9;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a78bfa;font-family:ui-monospace,monospace;margin-bottom:6px;">B&amp;W Myš · připomínky</div>
    ${items}
    <div style="font-size:11px;color:#6b665f;margin-top:18px;">
      <a href="${baseUrl}/bwmys" style="color:#a78bfa;">/bwmys</a>
    </div>
  </div>
</body></html>`;
}
