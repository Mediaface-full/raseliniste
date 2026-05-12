import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { searchPosta } from "@/lib/posta-search";

export const prerender = false;

const Body = z.object({
  query: z.string().min(1).max(500),
  filters: z
    .object({
      from: z.string().max(200).optional(),
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
      urgency: z.enum(["low", "medium", "high"]).optional(),
      contentType: z.string().max(40).optional(),
      actionType: z.string().max(40).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * POST /api/posta/search
 *
 * Hybrid search (ILIKE + vector cosine) přes mailovou historii.
 * Per Petrovo zadání fáze 4:
 *  - Sdílená služba, ne UI-specific
 *  - Combined score = 0.4 * ILIKE_norm + 0.6 * vector_score
 *  - Apply filters (from, date, urgency, contentType, actionType)
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "INVALID_INPUT", detail: err instanceof Error ? err.message : "" },
      { status: 400 },
    );
  }

  const filters = body.filters
    ? {
        from: body.filters.from,
        dateFrom: body.filters.dateFrom ? new Date(body.filters.dateFrom) : undefined,
        dateTo: body.filters.dateTo ? new Date(body.filters.dateTo) : undefined,
        urgency: body.filters.urgency,
        contentType: body.filters.contentType,
        actionType: body.filters.actionType,
      }
    : undefined;

  const { hits, stats } = await searchPosta(session.uid, {
    query: body.query,
    filters,
    limit: body.limit,
  });

  return Response.json({ ok: true, hits, stats });
};
