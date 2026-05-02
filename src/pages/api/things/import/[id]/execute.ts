import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { executeImport } from "@/lib/things-import";

export const prerender = false;

/**
 * POST /api/things/import/:id/execute
 *
 * Spustí zpracování importu na pozadí (fire-and-forget s pinning).
 * Vrátí OK okamžitě se status=executing. Klient pollují
 * GET /api/things/import/:id pro progress.
 *
 * Idempotentní: pokud status != "uploaded" (např. už proběhl),
 * vrátí 409.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const imp = await prisma.thingsImport.findFirst({
    where: { id, userId: session.uid },
  });
  if (!imp) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (imp.status !== "uploaded") {
    return Response.json(
      { error: `Import je ve stavu "${imp.status}", nelze spustit. Smaž ho a nahraj znovu pokud chceš retry.` },
      { status: 409 },
    );
  }

  // Fire-and-forget — module-level pinning v lib/things-import drží referenci
  void executeImport(id);

  return Response.json({ ok: true, importId: id, status: "executing" });
};
