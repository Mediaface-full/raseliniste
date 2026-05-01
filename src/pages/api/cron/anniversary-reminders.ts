import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";

export const prerender = false;

/**
 * Denně 7:00 (Synology Task Scheduler).
 *
 * Logika:
 *   1. Pro každého usera projde:
 *      a) Anniversary záznamy → pokud `dnes + reminderDaysBefore = výročí`, pošli
 *      b) Contacts s narozeninami + reminder nastavením → totéž
 *   2. Email kanál = funguje teď. WhatsApp = až bude vybraná služba.
 *
 * Curl:
 *   curl -X POST https://www.raseliniste.cz/api/cron/anniversary-reminders \
 *        -H "x-cron-key: <CRON_SECRET>"
 */

interface ReminderItem {
  kind: "anniversary" | "birthday";
  title: string;       // "Výročí svatby" / "Karel Novák narozeniny"
  yearsCount?: number; // u výročí pokud rok je zadán
  date: string;        // "3.5." (DD.M.)
  daysAhead: number;   // 0 = dnes, 7 = za týden
  channels: string[];
  note?: string | null;
}

function dueOn(month: number, day: number, todayY: number, todayM: number, todayD: number): { todayMatch: boolean; daysFromToday: number } {
  const today = new Date(todayY, todayM, todayD);
  let target = new Date(todayY, month - 1, day);
  if (target < today) target = new Date(todayY + 1, month - 1, day);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return { todayMatch: days === 0, daysFromToday: days };
}

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const today = new Date();
  const Y = today.getFullYear();
  const M = today.getMonth();
  const D = today.getDate();

  const users = await prisma.user.findMany({
    select: { id: true, username: true, notificationEmail: true },
  });

  const results: Array<{ user: string; sent: boolean; items: number; reason?: string }> = [];

  for (const user of users) {
    const items: ReminderItem[] = [];

    // (a) Výročí
    const anniversaries = await prisma.anniversary.findMany({
      where: {
        userId: user.id,
        reminderDaysBefore: { not: null },
      },
    });
    for (const a of anniversaries) {
      const { daysFromToday } = dueOn(a.month, a.day, Y, M, D);
      // Pošli pokud daysFromToday === reminderDaysBefore (přesně dnes je správný den k upozornění)
      if (daysFromToday === a.reminderDaysBefore) {
        const yearsCount = a.year ? Y - a.year : undefined;
        items.push({
          kind: "anniversary",
          title: a.title,
          yearsCount: yearsCount && yearsCount > 0 ? yearsCount : undefined,
          date: `${a.day}.${a.month}.`,
          daysAhead: daysFromToday,
          channels: a.reminderChannels,
          note: a.note,
        });
      }
    }

    // (b) Narozeniny kontaktů
    const contacts = await prisma.contact.findMany({
      where: {
        userId: user.id,
        birthMonth: { not: null },
        birthDay: { not: null },
        birthdayReminderDaysBefore: { not: null },
      },
      select: {
        displayName: true,
        firstName: true,
        birthMonth: true,
        birthDay: true,
        birthdayReminderDaysBefore: true,
        birthdayReminderChannels: true,
      },
    });
    for (const c of contacts) {
      const { daysFromToday } = dueOn(c.birthMonth!, c.birthDay!, Y, M, D);
      if (daysFromToday === c.birthdayReminderDaysBefore) {
        items.push({
          kind: "birthday",
          title: `Narozeniny — ${c.displayName}`,
          date: `${c.birthDay}.${c.birthMonth}.`,
          daysAhead: daysFromToday,
          channels: c.birthdayReminderChannels,
        });
      }
    }

    if (items.length === 0) {
      results.push({ user: user.username, sent: false, items: 0, reason: "nothing_today" });
      continue;
    }

    // Email kanál — sgrupuj všechny items co mají "email" v channels
    const emailItems = items.filter((i) => i.channels.includes("email"));
    if (emailItems.length > 0) {
      const to = user.notificationEmail ?? env.NOTIFICATION_EMAIL;
      if (to) {
        const html = renderHtml(emailItems);
        const subject = emailItems.length === 1
          ? `🕯 ${emailItems[0].kind === "anniversary" ? "Výročí" : "Narozeniny"} — ${emailItems[0].title}`
          : `🕯 ${emailItems.length} připomínek`;
        const text = emailItems.map((i) => `${i.title} (${i.date})${i.daysAhead === 0 ? " — dnes" : ` — za ${i.daysAhead} dní`}`).join("\n");
        const r = await sendMail({ to, subject, html, text });
        if (!r.ok) {
          results.push({ user: user.username, sent: false, items: items.length, reason: `mail_error: ${(r as { error: string }).error}` });
          continue;
        }
      }
    }

    // WhatsApp kanál — TODO až bude integrace
    const whatsItems = items.filter((i) => i.channels.includes("whatsapp"));
    if (whatsItems.length > 0) {
      console.log(`[anniversary-reminders] WhatsApp queue ${whatsItems.length} items pro ${user.username} — neimplementováno (vyber službu)`);
    }

    results.push({ user: user.username, sent: true, items: items.length });
  }

  return Response.json({ ok: true, processed: results });
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(items: ReminderItem[]): string {
  const rows = items.map((i) => {
    const daysLabel = i.daysAhead === 0
      ? "<strong style='color:#f4a4c7;'>DNES</strong>"
      : `za <strong>${i.daysAhead}</strong> ${i.daysAhead === 1 ? "den" : i.daysAhead < 5 ? "dny" : "dní"}`;
    const titleHtml = i.yearsCount
      ? `<strong>${i.yearsCount}. ${escapeHtml(i.title)}</strong>`
      : `<strong>${escapeHtml(i.title)}</strong>`;
    return `
      <div style="border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:10px;background:#241f1b;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9a8f82;font-family:ui-monospace,monospace;margin-bottom:4px;">
          ${i.kind === "anniversary" ? "🕯 Výročí" : "🎂 Narozeniny"} · ${escapeHtml(i.date)} · ${daysLabel}
        </div>
        <div style="font-size:18px;color:#fff;font-family:Georgia,serif;">${titleHtml}</div>
        ${i.note ? `<div style="font-size:13px;color:#c9c2b6;margin-top:6px;line-height:1.5;">${escapeHtml(i.note)}</div>` : ""}
      </div>
    `;
  }).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1714;color:#e8e3d9;font-family:-apple-system,BlinkMacSystemFont,'Geist','Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#f4a4c7;font-family:ui-monospace,monospace;margin-bottom:6px;">
      Rašeliniště · Připomínka
    </div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;color:#fff;">
      Nezapomeň
    </h1>
    ${rows}
    <div style="font-size:11px;color:#6b665f;font-family:ui-monospace,monospace;margin-top:18px;">
      Spravuj na <a href="https://www.raseliniste.cz/vyroci" style="color:#f4a4c7;">/vyroci</a> nebo <a href="https://www.raseliniste.cz/contacts" style="color:#f4a4c7;">/contacts</a>.
    </div>
  </div>
</body>
</html>`;
}
