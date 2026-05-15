/**
 * GET  /api/contacts/normalize-phones — preview kandidátů
 * POST /api/contacts/normalize-phones { phoneIds: string[] } — aplikuje
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { findPhoneNormalizationCandidates, applyPhoneNormalizations } from "@/lib/contacts-tools";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const candidates = await findPhoneNormalizationCandidates(session.uid);
  return Response.json({ ok: true, candidates });
};

const Body = z.object({ phoneIds: z.array(z.string()).min(1).max(2000) });

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  const result = await applyPhoneNormalizations(session.uid, body.phoneIds);
  return Response.json({ ok: true, ...result });
};
