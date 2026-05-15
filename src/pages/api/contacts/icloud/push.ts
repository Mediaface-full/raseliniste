/**
 * POST /api/contacts/icloud/push
 *
 * Push single contact z DB do iCloudu (PUT vCard).
 * Body: { contactId: string }
 *
 * Vola se po edit v `/contacts/tabulka`. Pokud Contact nemá icloudUid,
 * vygeneruje se UUID + vytvoří nový vCard. Jinak If-Match etag (412
 * pokud někdo upravil z jiného zařízení).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { pushContactToIcloud } from "@/lib/icloud-contacts";

export const prerender = false;

const Body = z.object({
  contactId: z.string().min(1),
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

  const result = await pushContactToIcloud(session.uid, body.contactId);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, etag: result.etag });
};
