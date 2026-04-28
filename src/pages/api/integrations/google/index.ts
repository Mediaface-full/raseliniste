import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { readSession } from "@/lib/session";
import { buildAuthUrl, isConnected, disconnect } from "@/lib/google-oauth";
import { prisma } from "@/lib/db";

export const prerender = false;

/**
 * GET  /api/integrations/google           — status (přihlášený user)
 * POST /api/integrations/google           — start OAuth (vrátí redirect URL)
 * DELETE /api/integrations/google         — disconnect
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const status = await isConnected(session.uid);

  // Stats: kolik událostí + kontaktů máme synchronizovaných
  const eventsCount = await prisma.calendarEvent.count({
    where: { source: "GOOGLE_PRIMARY", deletedRemotely: false },
  });
  const contactsCount = await prisma.contact.count({
    where: { userId: session.uid, googleResourceName: { not: null } },
  });

  return Response.json({
    ...status,
    stats: { events: eventsCount, contacts: contactsCount },
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Generate state nonce, ulož ho do cookie pro callback ověření
  const state = randomBytes(24).toString("base64url");
  const url = buildAuthUrl(state);

  return new Response(JSON.stringify({ url, state }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `google_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`,
    },
  });
};

export const DELETE: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await disconnect(session.uid, true);
  return Response.json({ ok: true });
};
