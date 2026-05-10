import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { authorizeWebhook, extractGosmsMessageId } from "@/lib/gosms-webhook";

export const prerender = false;

/**
 * POST — webhook s doručenkami z GoSMS.
 *
 * Autorizace: ?token=<webhookSecret> v query, matchovaný proti
 * UserIntegration.config.webhookSecret.
 *
 * Payload (pole eventů):
 * [
 *   {
 *     event: "delivery",
 *     delivery: {
 *       isDelivered: bool,
 *       smsCount, deliveredSmsCount,
 *       recipients: { delivered: { "+420...": "ISO date", ... }, undelivered: {...}, delivering: {...} }
 *     },
 *     links: { message: "/api/v1/messages/...", replies: "..." }
 *   }
 * ]
 *
 * Vrací 200 vždy (i když jsme něco nezpracovali — GoSMS jinak retryuje).
 * Chyby logujeme ale neselháváme.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get("token");
  const auth = await authorizeWebhook(token);
  if (!auth) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const events = Array.isArray(payload) ? payload : [];
  let processed = 0;

  for (const ev of events as Array<{
    event?: string;
    delivery?: {
      isDelivered?: boolean;
      smsCount?: number;
      deliveredSmsCount?: number;
      recipients?: {
        delivered?: Record<string, string>;
        undelivered?: Record<string, string>;
        delivering?: unknown;
      };
    };
    links?: { message?: string };
  }>) {
    if (ev.event !== "delivery" || !ev.delivery) continue;

    const gosmsId = extractGosmsMessageId(ev.links?.message);
    if (!gosmsId) continue;

    const sms = await prisma.smsMessage.findFirst({
      where: { userId: auth.userId, gosmsMessageId: gosmsId },
    });
    if (!sms) continue;

    const recipients = ev.delivery.recipients ?? {};
    const delivered = recipients.delivered ?? {};
    const undelivered = recipients.undelivered ?? {};

    // Status: delivered pokud je alespoň 1 doručené, undelivered pokud všechno selhalo,
    // jinak ponecháme sent (čekáme na další doručenky).
    const hasDelivered = Object.keys(delivered).length > 0;
    const hasUndelivered = Object.keys(undelivered).length > 0;
    const everyoneFailed =
      hasUndelivered &&
      !hasDelivered &&
      Object.keys(recipients.delivering ?? {}).length === 0;

    const newStatus = hasDelivered
      ? "delivered"
      : everyoneFailed
        ? "undelivered"
        : sms.status;

    // Najdi nejranější timestamp z delivered pro deliveredAt
    let firstDeliveredAt: Date | null = null;
    for (const t of Object.values(delivered)) {
      const d = new Date(t);
      if (!isNaN(d.getTime()) && (!firstDeliveredAt || d < firstDeliveredAt)) {
        firstDeliveredAt = d;
      }
    }

    await prisma.smsMessage.update({
      where: { id: sms.id },
      data: {
        status: newStatus as never,
        deliveredAt: firstDeliveredAt ?? sms.deliveredAt ?? undefined,
        deliveryDetails: recipients as unknown as object,
      },
    });
    processed++;
  }

  return Response.json({ ok: true, processed });
};
