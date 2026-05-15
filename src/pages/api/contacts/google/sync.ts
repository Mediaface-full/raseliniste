/**
 * POST /api/contacts/google/sync — push všeho z Rašeliniště do Google Workspace
 *
 * Body (volitelné): { scope: "all" | { company } | { group } }
 *
 * Petr 2026-05-15 (kontakty_brief.md F6).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { syncIcloudToGoogle } from "@/lib/google-contacts-sync";

export const prerender = false;

const Body = z.object({
  scope: z.union([
    z.literal("all"),
    z.object({ company: z.string().min(1) }),
    z.object({ group: z.string().min(1) }),
  ]).optional(),
});

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body> = {};
  try {
    body = Body.parse(await request.json().catch(() => ({})));
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  const result = await syncIcloudToGoogle(session.uid, { scope: body.scope });
  return Response.json(result);
};
