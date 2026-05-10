import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { authorizeWebhook, extractGosmsMessageId } from "@/lib/gosms-webhook";
import { normalizePhone } from "@/lib/phone";

export const prerender = false;

/**
 * POST — webhook s příchozími odpověďmi z GoSMS.
 *
 * Payload (pole eventů):
 * [
 *   {
 *     event: "reply",
 *     reply: {
 *       hasReplies: true,
 *       repliesCount: N,
 *       recipients: {
 *         "+420111222333": [
 *           { id, message, sourceNumber, received, partNumber?, partsCount?, messageReferenceNumber? }
 *         ]
 *       }
 *     },
 *     links: { message: "/api/v1/messages/...", replies: "..." } | null
 *   }
 * ]
 *
 * Pokud links je null, odpověď nebyla spárována — uložíme ji bez smsMessageId.
 *
 * Idempotence: gosmsReplyId @unique → upsert by-id zabrání duplicitě při retry.
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
  let stored = 0;

  for (const ev of events as Array<{
    event?: string;
    reply?: {
      recipients?: Record<
        string,
        Array<{
          id: number | string;
          message: string;
          sourceNumber: string;
          received: string;
          partNumber?: number;
          partsCount?: number;
          messageReferenceNumber?: number;
        }>
      >;
    };
    links?: { message?: string } | null;
  }>) {
    if (ev.event !== "reply" || !ev.reply) continue;

    const gosmsMessageId = extractGosmsMessageId(ev.links?.message);
    let smsMessageId: string | null = null;
    if (gosmsMessageId) {
      const sms = await prisma.smsMessage.findFirst({
        where: { userId: auth.userId, gosmsMessageId },
        select: { id: true },
      });
      smsMessageId = sms?.id ?? null;
    }

    const recipients = ev.reply.recipients ?? {};
    for (const [fromRaw, replies] of Object.entries(recipients)) {
      const fromNorm = normalizePhone(fromRaw) ?? fromRaw;
      for (const r of replies) {
        const replyId = String(r.id);
        try {
          await prisma.smsReply.upsert({
            where: { gosmsReplyId: replyId },
            create: {
              userId: auth.userId,
              smsMessageId,
              gosmsReplyId: replyId,
              fromNumber: fromNorm,
              toSourceNumber: r.sourceNumber,
              body: r.message,
              receivedAt: new Date(r.received),
              partNumber: r.partNumber ?? null,
              partsCount: r.partsCount ?? null,
              messageReferenceNumber: r.messageReferenceNumber ?? null,
            },
            update: {
              // Pokud reply přišla podruhé s nově spárovanou message, doplníme link.
              smsMessageId: smsMessageId ?? undefined,
            },
          });
          stored++;
        } catch {
          // Neselháváme webhook — log lze přidat později
        }
      }
    }
  }

  return Response.json({ ok: true, stored });
};
