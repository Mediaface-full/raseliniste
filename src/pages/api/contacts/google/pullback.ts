/**
 * GET  /api/contacts/google/pullback — kandidáti pull-back (jen v Googlu)
 * POST /api/contacts/google/pullback { resourceNames: string[] } — nahraje
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { findPullBackCandidates, pullBackFromGoogle } from "@/lib/google-contacts-sync";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const candidates = await findPullBackCandidates(session.uid);
  return Response.json({ ok: true, candidates });
};

const Body = z.object({ resourceNames: z.array(z.string()).min(1).max(500) });

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }
  const result = await pullBackFromGoogle(session.uid, body.resourceNames);
  return Response.json(result);
};
