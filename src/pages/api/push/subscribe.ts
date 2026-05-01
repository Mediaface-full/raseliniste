import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { getVapidPublicKey, sendPushToUser } from "@/lib/webpush";

export const prerender = false;

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(20),
    auth: z.string().min(10),
  }),
  label: z.string().max(100).optional(),
});

// GET — vrátí VAPID public key + seznam aktivních subscriptions usera
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const vapid = getVapidPublicKey();
  const subs = await prisma.webPushSubscription.findMany({
    where: { userId: session.uid },
    select: {
      id: true, label: true, createdAt: true, lastUsedAt: true, lastError: true, endpoint: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    vapidPublicKey: vapid,
    subscriptions: subs.map((s) => ({
      id: s.id,
      label: s.label,
      endpointTail: s.endpoint.slice(-30),
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      lastError: s.lastError,
    })),
  });
};

// POST — uloží novou subscription (klientský PushSubscription objekt)
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof SubscribeBody>;
  try {
    body = SubscribeBody.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  // Upsert přes endpoint (jeden device = jedna subscription)
  const sub = await prisma.webPushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label ?? undefined,
      userId: session.uid,
      lastError: null,
    },
    create: {
      userId: session.uid,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label ?? null,
    },
  });

  return Response.json({ ok: true, id: sub.id });
};

// PUT — pošle test push (nikdy „skutečné" — jen ověření)
export const PUT: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const result = await sendPushToUser(session.uid, {
    title: "Rašeliniště — test",
    body: "Push notifikace fungují. Můžeš zavřít.",
    url: "/start",
    tag: "test-push",
  });
  return Response.json(result);
};

// DELETE ?id=xxx — smazat konkrétní subscription
export const DELETE: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "MISSING_ID" }, { status: 400 });

  const owned = await prisma.webPushSubscription.findFirst({
    where: { id, userId: session.uid },
  });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.webPushSubscription.delete({ where: { id } });
  return Response.json({ ok: true });
};
