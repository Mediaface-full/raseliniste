import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { classifyPendingForUser, classifyEmail } from "@/lib/posta-classify";

export const prerender = false;

const Body = z
  .object({
    /** Maximum mailů k klasifikaci v této dávce. Default 50, max 200. */
    limit: z.number().int().min(1).max(200).optional(),
    /** Reklasifikovat i mailí co už mají klasifikaci. Default false. */
    force: z.boolean().optional(),
    /** Specific email IDs k reklasifikaci (override limit). */
    emailIds: z.array(z.string()).max(200).optional(),
  })
  .optional();

/**
 * POST /api/integrations/google/posta-classify
 *
 * Manuální spuštění klasifikace pro přihlášeného uživatele.
 *
 * Default chování: najde unclassified maily (max 50), klasifikuje.
 * S `force: true` reklasifikuje i existující.
 * S `emailIds: [...]` reklasifikuje konkrétní (pro retry chybných).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body> = undefined;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const raw = await request.json().catch(() => undefined);
      body = Body.parse(raw);
    }
  } catch (err) {
    return Response.json(
      { error: "INVALID_INPUT", detail: err instanceof Error ? err.message : "" },
      { status: 400 },
    );
  }

  // Specific email IDs path
  if (body?.emailIds && body.emailIds.length > 0) {
    const results = [];
    for (const id of body.emailIds) {
      results.push(await classifyEmail(id, { force: body.force ?? true }));
    }
    return Response.json({
      ok: true,
      mode: "specific",
      total: results.length,
      classified: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      errors: results.filter((r) => !r.ok).length,
      errorDetails: results
        .filter((r) => !r.ok)
        .map((r) => ({ emailId: r.emailId, error: r.error ?? "?" })),
    });
  }

  // Default: pending batch
  const stats = await classifyPendingForUser(session.uid, body?.limit ?? 50);

  return Response.json({
    ok: true,
    mode: "pending",
    total: stats.total,
    classified: stats.classified,
    skipped: stats.skipped,
    errors: stats.errors,
    errorDetails: stats.errorDetails,
    durationMs: stats.durationMs,
  });
};
