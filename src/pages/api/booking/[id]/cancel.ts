import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { cancelInvite } from "@/lib/booking";

export const prerender = false;

/**
 * POST /api/booking/:id/cancel — admin (Petr) zruší pozvánku
 * Pokud byla v RESERVED/CONFIRMED a má email, pošle cancellation mail.
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  try {
    await cancelInvite(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
