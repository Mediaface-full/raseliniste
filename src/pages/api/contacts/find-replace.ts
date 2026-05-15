/**
 * POST /api/contacts/find-replace
 *
 * Body: { column, find, replace, regex, caseSensitive, contactIds?, action: "preview"|"apply" }
 *   - column: displayName | firstName | lastName | company | note | phones | emails
 *   - regex / caseSensitive: bool
 *   - contactIds: omezit na podmnožinu (filtered)
 *   - action: preview (default) vrátí seznam změn, apply provede
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { findReplacePreview, findReplaceApply } from "@/lib/contacts-tools";

export const prerender = false;

const Body = z.object({
  column: z.enum(["displayName", "firstName", "lastName", "company", "note", "phones", "emails"]),
  find: z.string().min(1).max(500),
  replace: z.string().max(500),
  regex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  contactIds: z.array(z.string()).optional(),
  action: z.enum(["preview", "apply"]).default("preview"),
});

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Validace regex pattern
  if (body.regex) {
    try {
      new RegExp(body.find);
    } catch {
      return Response.json({ error: "Neplatný regex pattern." }, { status: 400 });
    }
  }

  if (body.action === "preview") {
    const result = await findReplacePreview(session.uid, body);
    return Response.json({ ok: true, ...result });
  }

  const result = await findReplaceApply(session.uid, body);
  return Response.json({ ok: true, ...result });
};
