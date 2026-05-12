import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { generateDigestForUser } from "@/lib/posta-digest";

export const prerender = false;

const Body = z
  .object({
    /** Přepsat existující digest pro dnešek (default false = idempotent reuse). */
    force: z.boolean().optional(),
  })
  .optional();

/**
 * POST /api/integrations/google/posta-digest
 * Manuální spuštění generování digestu pro přihlášeného uživatele.
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
  } catch {
    // ignore — body je volitelný
  }

  const stats = await generateDigestForUser(session.uid, { force: body?.force ?? false });

  if (!stats.ok) {
    return Response.json({ ok: false, error: stats.error ?? "Generování selhalo." }, { status: 500 });
  }
  return Response.json({ ok: true, stats });
};
