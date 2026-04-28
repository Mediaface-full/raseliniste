import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { selectCalendars } from "@/lib/icloud-calendar";

export const prerender = false;

const schema = z.object({
  sonCalendarUrl: z.string().url().optional(),
  sonCalendarName: z.string().optional(),
  partnerCalendarUrl: z.string().url().optional(),
  partnerCalendarName: z.string().optional(),
});

/**
 * POST /api/integrations/icloud/select
 * Body: { sonCalendarUrl?, sonCalendarName?, partnerCalendarUrl?, partnerCalendarName? }
 *
 * Uloží výběr kalendářů. Lze odeslat jen jeden z nich, druhý zůstane.
 * Pro „odznačení" pošli prázdný string (převedeme na undefined → výběr smazán).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    await selectCalendars(session.uid, parsed.data);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
