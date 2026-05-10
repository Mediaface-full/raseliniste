import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET — výpis posledních N SmsMessage uživatele.
 * Query: ?limit=50&status=sent (volitelný status filter)
 */
export const GET: APIRoute = async ({ url, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const statusFilter = url.searchParams.get("status");

  const messages = await prisma.smsMessage.findMany({
    where: {
      userId: session.uid,
      ...(statusFilter ? { status: statusFilter as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      gosmsMessageId: true,
      recipients: true,
      invalidRecipients: true,
      body: true,
      channelId: true,
      status: true,
      scheduledFor: true,
      linkedEntity: true,
      cost: true,
      currency: true,
      isPinned: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      errorMessage: true,
      createdAt: true,
      replies: {
        select: { id: true, fromNumber: true, body: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  return Response.json({ messages });
};
