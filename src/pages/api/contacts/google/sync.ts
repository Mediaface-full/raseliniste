/**
 * POST /api/contacts/google/sync — OBOUSMĚRNÝ sync Rašeliniště ↔ Google Workspace
 *
 * Body (volitelné):
 *   { scope: "all" | { company } | { group }, direction: "bidirectional" | "push-only" }
 *
 * Default `direction=bidirectional` — Petr 2026-05-15: pravý sync, ne jen push.
 *
 * push-only = legacy chování (jen iCloud → Google) zachováno pro F8 cleanup
 * případy. Bidirectional = last-write-wins podle Google updateTime vs
 * Contact.lastGoogleSyncAt / Contact.updatedAt.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { syncIcloudToGoogle, syncWithGoogle } from "@/lib/google-contacts-sync";

export const prerender = false;

const Body = z.object({
  scope: z.union([
    z.literal("all"),
    z.object({ company: z.string().min(1) }),
    z.object({ group: z.string().min(1) }),
  ]).optional(),
  direction: z.enum(["bidirectional", "push-only"]).default("bidirectional"),
});

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body> = { direction: "bidirectional" };
  try {
    body = Body.parse(await request.json().catch(() => ({})));
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  const result = body.direction === "push-only"
    ? await syncIcloudToGoogle(session.uid, { scope: body.scope })
    : await syncWithGoogle(session.uid, { scope: body.scope });
  return Response.json(result);
};
