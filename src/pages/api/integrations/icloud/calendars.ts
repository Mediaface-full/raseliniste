import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { listCalendars } from "@/lib/icloud-calendar";

export const prerender = false;

/**
 * GET /api/integrations/icloud/calendars
 *
 * Vrátí seznam kalendářů dostupných pod uloženými iCloud credentials.
 * Volá se po POST /api/integrations/icloud (uložení Apple ID + hesla),
 * UI z toho udělá dvojici dropdownů „Synův kalendář" + „Partnerčin kalendář".
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  try {
    const calendars = await listCalendars(session.uid);
    return Response.json({ calendars });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
