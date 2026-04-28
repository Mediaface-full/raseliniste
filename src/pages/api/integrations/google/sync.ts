import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { syncGoogleCalendar } from "@/lib/google-calendar";
import { syncGooglePeople } from "@/lib/google-people";

export const prerender = false;

/**
 * POST /api/integrations/google/sync
 * Body: { what: "calendar" | "contacts" | "all" }
 *
 * Manuální spuštění sync z UI tlačítek.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const what = body.what ?? "all";

  const result: Record<string, unknown> = {};

  try {
    if (what === "calendar" || what === "all") {
      result.calendar = await syncGoogleCalendar(session.uid);
    }
    if (what === "contacts" || what === "all") {
      result.contacts = await syncGooglePeople(session.uid);
    }
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), partial: result },
      { status: 500 },
    );
  }
};
