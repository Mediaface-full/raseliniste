import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { ensureCallLogToken, regenerateCallLogToken } from "@/lib/call-log-token";

export const prerender = false;

/**
 * GET  /api/contacts/[id]/call-log-token   — vrátí (a případně auto-vygeneruje) token
 * POST /api/contacts/[id]/call-log-token   — vždy vygeneruje nový (regenerate)
 *
 * Auth: session. Jen pro VIP kontakty (kde isVip=true). Token = privátní klíč
 * pro /call-log?t=<token>; regenerace zruší předchozí link.
 */

async function ownVipContact(userId: string, id: string) {
  const c = await prisma.contact.findFirst({
    where: { id, userId },
    select: { id: true, isVip: true },
  });
  return c;
}

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const c = await ownVipContact(session.uid, id);
  if (!c) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!c.isVip) return Response.json({ error: "NOT_VIP" }, { status: 400 });

  const token = await ensureCallLogToken(id);
  return Response.json({ token });
};

export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const c = await ownVipContact(session.uid, id);
  if (!c) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!c.isVip) return Response.json({ error: "NOT_VIP" }, { status: 400 });

  const token = await regenerateCallLogToken(id);
  return Response.json({ token });
};
