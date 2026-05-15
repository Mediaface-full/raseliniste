/**
 * GET  /api/contacts/google/cleanup — najde clustery duplicit v Googlu
 * POST /api/contacts/google/cleanup — smaže ostatní (zachová `keep`)
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { findGoogleDuplicates, cleanupGoogleDuplicates } from "@/lib/google-contacts-sync";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const clusters = await findGoogleDuplicates(session.uid);
  return Response.json({
    ok: true,
    clusters: clusters.map((c) => ({
      members: c.members.map((m) => ({ resourceName: m.resourceName, fn: m.fn, phones: m.phones, emails: m.emails })),
      keep: c.keep.resourceName,
    })),
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const result = await cleanupGoogleDuplicates(session.uid);
  return Response.json(result);
};
