/**
 * GET  /api/contacts/duplicates — najde clustery duplicit
 * POST /api/contacts/duplicates/merge — sloučí cluster
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.8 B).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { findDuplicateClusters, mergeContacts } from "@/lib/contacts-duplicates";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const clusters = await findDuplicateClusters(session.uid);
  return Response.json({ ok: true, clusters });
};

const MergeBody = z.object({
  primaryId: z.string().min(1),
  secondaryIds: z.array(z.string().min(1)).min(1).max(50),
});

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof MergeBody>;
  try {
    body = MergeBody.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Bezpečnost: primary nesmí být v secondary
  if (body.secondaryIds.includes(body.primaryId)) {
    return Response.json({ error: "Primární kontakt nemůže být v seznamu secondary." }, { status: 400 });
  }

  const result = await mergeContacts(session.uid, body.primaryId, body.secondaryIds);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
};
