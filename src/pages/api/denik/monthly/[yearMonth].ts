import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { generateMonthlyReview } from "@/lib/journal-monthly-review";

export const prerender = false;

/**
 * GET /api/denik/monthly/YYYY-MM
 *
 * Vygeneruje (každé volání = fresh AI run) měsíční rekapitulaci.
 * Žádný caching — Gideon si může pouštět review opakovaně, aktuální je vždy.
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const ym = params.yearMonth as string;
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return Response.json({ error: "Format YYYY-MM" }, { status: 400 });

  const year = parseInt(m[1]);
  const month = parseInt(m[2]);
  if (month < 1 || month > 12) return Response.json({ error: "Invalid month" }, { status: 400 });

  try {
    const review = await generateMonthlyReview({ userId: session.uid, year, month });
    return Response.json({ review });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
