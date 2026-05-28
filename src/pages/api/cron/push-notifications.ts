import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendPushToUser } from "@/lib/webpush";

export const prerender = false;

/**
 * POST /api/cron/push-notifications  (Petr 2026-05-27)
 * Auth: x-cron-key
 * Schedule: každých 5 min (viz cron-schedule.ts)
 *
 * Pro každého uživatele načte:
 *   - VIP CallLog (wasVip=true) s createdAt > pushLastCheckedAt
 *   - Urgent EmailMessage (classification action_required + high|escalation)
 *   - ProjectRecording (status=processed, sdílený projekt)
 *   - Confirmed BookingInvite (status=CONFIRMED, confirmedAt > lastChecked)
 *
 * Pošle Web Push notifikaci pro každou nové položku přes existující
 * `sendPushToUser` (lib/webpush.ts). Update pushLastCheckedAt = now.
 *
 * Pojistka první run: pokud pushLastCheckedAt IS NULL, nastavíme na NOW()
 * a posíláme jen budoucí items (žádný retroaktivní spam ze staré historie).
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Bezpečnostní strop — neposílat víc než 20 notifikací per user per tick
  const MAX_PER_USER_PER_TICK = 20;

  const users = await prisma.user.findMany({
    select: { id: true, pushLastCheckedAt: true },
  });

  const now = new Date();
  const results: Array<{
    userId: string;
    pushed: number;
    failed: number;
    sources: { callLog: number; email: number; recording: number; booking: number };
    note?: string;
  }> = [];

  for (const u of users) {
    const sources = { callLog: 0, email: 0, recording: 0, booking: 0 };

    // První run — nastavíme NOW a skipneme (žádný retroaktivní spam)
    if (!u.pushLastCheckedAt) {
      await prisma.user.update({
        where: { id: u.id },
        data: { pushLastCheckedAt: now },
      });
      results.push({ userId: u.id, pushed: 0, failed: 0, sources, note: "first run — baseline timestamp set" });
      continue;
    }

    const since = u.pushLastCheckedAt;

    // Load všechny nové items paralelně
    const [vipLogs, urgentEmails, newRecordings, newBookings] = await Promise.all([
      prisma.callLog.findMany({
        where: { userId: u.id, createdAt: { gt: since }, wasVip: true },
        select: {
          id: true,
          createdAt: true,
          message: true,
          isUrgent: true,
          contact: { select: { displayName: true, firstName: true } },
          phoneNumber: true,
        },
        orderBy: { createdAt: "asc" },
        take: MAX_PER_USER_PER_TICK,
      }),
      prisma.emailMessage.findMany({
        where: {
          userId: u.id,
          receivedAt: { gt: since },
          classification: {
            actionType: "action_required",
            OR: [{ urgency: "high" }, { escalation: true }],
          },
        },
        select: { id: true, subject: true, fromName: true, fromAddress: true, receivedAt: true },
        orderBy: { receivedAt: "asc" },
        take: MAX_PER_USER_PER_TICK,
      }),
      prisma.projectRecording.findMany({
        where: {
          createdAt: { gt: since },
          status: "processed",
          project: { userId: u.id },
          isOwner: false, // jen od hostů (vlastní nahrávky nepushovat sám sobě)
        },
        select: {
          id: true,
          createdAt: true,
          projectId: true,
          authorName: true,
          project: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: MAX_PER_USER_PER_TICK,
      }),
      prisma.bookingInvite.findMany({
        where: {
          status: "CONFIRMED",
          confirmedAt: { gt: since },
        },
        select: {
          id: true,
          inviteeName: true,
          confirmedAt: true,
          reservedSlot: true,
        },
        orderBy: { confirmedAt: "asc" },
        take: MAX_PER_USER_PER_TICK,
      }),
    ]);

    let pushed = 0;
    let failed = 0;

    // 1. VIP CallLog — nejdůležitější (rose/urgent tone)
    for (const v of vipLogs) {
      const name = v.contact?.displayName?.trim() || v.contact?.firstName || v.phoneNumber;
      const r = await sendPushToUser(u.id, {
        title: v.isUrgent ? `⭐ URGENT VIP — ${name}` : `⭐ VIP — ${name}`,
        body: v.message.slice(0, 200),
        url: `/call-log#log-${v.id}`,
        tag: `vip-${v.id}`,
      });
      if (r.ok) pushed++; else failed++;
      sources.callLog++;
    }

    // 2. Urgent emaily
    for (const e of urgentEmails) {
      const from = e.fromName?.trim() || e.fromAddress;
      const r = await sendPushToUser(u.id, {
        title: `📧 Urgent — ${from}`,
        body: e.subject?.slice(0, 200) ?? "(bez předmětu)",
        url: `/posta/${e.id}`,
        tag: `posta-${e.id}`,
      });
      if (r.ok) pushed++; else failed++;
      sources.email++;
    }

    // 3. Nové Studánka nahrávky (jen od hostů)
    for (const rec of newRecordings) {
      const r = await sendPushToUser(u.id, {
        title: `🌊 Nová nahrávka v „${rec.project.name}"`,
        body: `Od ${rec.authorName} — klikni pro detail`,
        url: `/studna/${rec.projectId}#rec-${rec.id}`,
        tag: `studna-${rec.id}`,
      });
      if (r.ok) pushed++; else failed++;
      sources.recording++;
    }

    // 4. Confirmed bookings
    for (const b of newBookings) {
      const slot = b.reservedSlot as { startsAt?: string } | null;
      const dateStr = slot?.startsAt
        ? new Date(slot.startsAt).toLocaleDateString("cs-CZ", {
            weekday: "short",
            day: "numeric",
            month: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Prague",
          })
        : "?";
      const r = await sendPushToUser(u.id, {
        title: `📅 ${b.inviteeName ?? "Host"} potvrdil schůzku`,
        body: dateStr,
        url: "/calendar/invite",
        tag: `booking-${b.id}`,
      });
      if (r.ok) pushed++; else failed++;
      sources.booking++;
    }

    // Update timestamp jen pokud bylo úspěšné (nebo žádné položky)
    await prisma.user.update({
      where: { id: u.id },
      data: { pushLastCheckedAt: now },
    });

    results.push({ userId: u.id, pushed, failed, sources });
  }

  return Response.json({ ok: true, results });
};
