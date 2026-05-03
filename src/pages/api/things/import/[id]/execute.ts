import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { executeImport, preflightProjectCheck, type CuratedFileT } from "@/lib/things-import";
import { createProject } from "@/lib/todoist";
import { decryptSecret } from "@/lib/crypto";

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
 *
 * Auto-create chybějících projektů (NOVÉ 05-03):
 * Pokud import chce posílat tasky do projektů co nejsou v TodoistProjectMirror,
 * sami je v Todoistu vytvoříme + zapíšeme do mirroru. Petr to už nemusí dělat
 * ručně. Pokud Todoist API selže, vrátíme 422 s detaily co se pokazilo.
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

  // Pre-flight: zjistit chybějící projekty
  const raw = imp.rawJson as unknown as CuratedFileT;
  const missingProjects = await preflightProjectCheck(session.uid, raw.items);

  const createdProjects: string[] = [];
  const failedProjects: { name: string; error: string }[] = [];

  if (missingProjects.length > 0) {
    // Načti Todoist token
    const integration = await prisma.userIntegration.findUnique({
      where: { userId_provider: { userId: session.uid, provider: "todoist" } },
    });
    if (!integration) {
      return Response.json(
        { error: "TODOIST_NOT_CONFIGURED", message: "Todoist integrace není nakonfigurovaná. Připoj ji v /settings/integrations." },
        { status: 400 },
      );
    }
    const token = decryptSecret({
      enc: integration.tokenEnc,
      iv: integration.tokenIv,
      tag: integration.tokenTag,
    });

    // Vytvoř každý chybějící projekt v Todoistu + v mirroru
    for (const projectName of missingProjects) {
      try {
        const created = await createProject(token, { name: projectName });
        await prisma.todoistProjectMirror.create({
          data: {
            userId: session.uid,
            todoistId: created.id,
            name: created.name,
            color: created.color ?? null,
            isInbox: created.is_inbox_project ?? false,
            parentId: created.parent_id ?? null,
          },
        });
        createdProjects.push(projectName);
      } catch (e) {
        failedProjects.push({
          name: projectName,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (failedProjects.length > 0) {
      return Response.json(
        {
          error: "PROJECTS_CREATE_FAILED",
          message:
            `Nepodařilo se vytvořit projekty v Todoistu: ${failedProjects.map((p) => `"${p.name}" (${p.error})`).join(", ")}. ` +
            `Vytvořené: ${createdProjects.length}/${missingProjects.length}.`,
          createdProjects,
          failedProjects,
        },
        { status: 422 },
      );
    }
  }

  // Fire-and-forget — module-level pinning v lib/things-import drží referenci
  void executeImport(id);

  return Response.json({
    ok: true,
    importId: id,
    status: "executing",
    autoCreatedProjects: createdProjects,
  });
};
