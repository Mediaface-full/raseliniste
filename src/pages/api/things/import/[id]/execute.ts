import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { executeImport, preflightProjectCheck, type CuratedFileT } from "@/lib/things-import";

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

  // Pre-flight check projektů — pokud chybí, blokovat se srozumitelnou hláškou
  const raw = imp.rawJson as unknown as CuratedFileT;
  const missingProjects = await preflightProjectCheck(session.uid, raw.items);
  if (missingProjects.length > 0) {
    return Response.json(
      {
        error: "PROJECTS_MISSING",
        message:
          `V Todoistu chybí ${missingProjects.length === 1 ? "projekt" : "projekty"}: ${missingProjects.map((p) => `"${p}"`).join(", ")}. ` +
          `Založ ${missingProjects.length === 1 ? "ho" : "je"} v Todoistu (nebo přes /settings/integrations → Bulk import) a spusť scheduler/sync, ať se ${missingProjects.length === 1 ? "natáhne" : "natáhnou"} do Todoist project mirroru. Pak zkus migraci znovu.`,
        missingProjects,
      },
      { status: 422 },
    );
  }

  // Fire-and-forget — module-level pinning v lib/things-import drží referenci
  void executeImport(id);

  return Response.json({ ok: true, importId: id, status: "executing" });
};
