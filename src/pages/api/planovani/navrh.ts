import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { proposeWeekPlan } from "@/lib/planning-ai";

export const prerender = false;

const Body = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // pondělí týdne
});

/**
 * POST /api/planovani/navrh — AI návrh rozložení týdne (weekly review, F2).
 * Synchronní (flash, ~10-20 s) — UI drží loading stav na tlačítku.
 * AI nic nezapisuje; zápis dělá až /api/planovani/potvrdit.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  try {
    const result = await proposeWeekPlan(session.uid, parsed.data.week);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[planovani-navrh] failed:", msg);
    return Response.json({ error: `Návrh se nepovedl: ${msg}` }, { status: 502 });
  }
};
