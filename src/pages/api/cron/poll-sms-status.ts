import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { loadGosmsCredentials, getMessage } from "@/lib/gosms";

export const prerender = false;

/**
 * GoSMS — fallback polling stavu odeslaných SMS.
 *
 * Pojistka pro případ že webhook spadne nebo není nakonfigurovaný v GoSMS samoobsluze.
 * Volá se každých 30 min přes dispatcher.
 *
 * Logika:
 *  - Najdi všechny SmsMessage status=sent posledních 24h s gosmsMessageId
 *  - Per zpráva zavolej GET /v1/messages/{id}
 *  - Aktualizuj status / deliveredAt / deliveryDetails podle odpovědi
 *  - Stejná logika jako delivery webhook (delivered / undelivered / sent)
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pending = await prisma.smsMessage.findMany({
    where: {
      status: "sent",
      gosmsMessageId: { not: null },
      sentAt: { gte: since },
    },
    select: { id: true, userId: true, gosmsMessageId: true, deliveredAt: true, status: true },
    take: 100,
  });

  // Group by user pro efektivní credential load
  const byUser = new Map<string, typeof pending>();
  for (const m of pending) {
    const arr = byUser.get(m.userId) ?? [];
    arr.push(m);
    byUser.set(m.userId, arr);
  }

  let updated = 0;
  let errors = 0;

  for (const [userId, messages] of byUser) {
    const loaded = await loadGosmsCredentials(userId);
    if (!loaded) continue;

    for (const m of messages) {
      if (!m.gosmsMessageId) continue;
      try {
        const detail = await getMessage(userId, loaded.creds, m.gosmsMessageId);
        const recipients = detail.recipients ?? {};
        const delivered = recipients.delivered ?? {};
        const undelivered = recipients.undelivered ?? {};
        const delivering = recipients.delivering ?? {};

        const hasDelivered = Object.keys(delivered).length > 0;
        const hasUndelivered = Object.keys(undelivered).length > 0;
        const everyoneFailed =
          hasUndelivered && !hasDelivered && Object.keys(delivering).length === 0;

        const newStatus = hasDelivered ? "delivered" : everyoneFailed ? "undelivered" : m.status;

        let firstDeliveredAt: Date | null = null;
        for (const t of Object.values(delivered)) {
          const d = new Date(t);
          if (!isNaN(d.getTime()) && (!firstDeliveredAt || d < firstDeliveredAt)) {
            firstDeliveredAt = d;
          }
        }

        if (newStatus !== m.status || (firstDeliveredAt && !m.deliveredAt)) {
          await prisma.smsMessage.update({
            where: { id: m.id },
            data: {
              status: newStatus as never,
              deliveredAt: firstDeliveredAt ?? undefined,
              deliveryDetails: recipients as unknown as object,
            },
          });
          updated++;
        }
      } catch {
        errors++;
      }
    }
  }

  return Response.json({ ok: true, scanned: pending.length, updated, errors });
};
