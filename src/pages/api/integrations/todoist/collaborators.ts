import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { listAllCollaborators } from "@/lib/todoist";

export const prerender = false;

/**
 * GET /api/integrations/todoist/collaborators  (Petr 2026-05-25)
 *
 * Listne všechny Workspace collaborators co Petr vidí napříč svými Todoist
 * projekty. Petr si tam najde Todoist user ID Gáti/Lucie/Matěje a vyplní
 * v UI kontaktů (Contact.todoistUserId), aby task push posílal responsible_uid.
 *
 * Response: { ok, collaborators: [{ id, name, email }] }
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ error: "TODOIST_NOT_CONFIGURED" }, { status: 400 });
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  try {
    const collaborators = await listAllCollaborators(token);
    return Response.json({ ok: true, collaborators });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
