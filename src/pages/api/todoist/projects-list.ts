import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { listSections } from "@/lib/todoist";

export const prerender = false;

/**
 * GET /api/todoist/projects-list
 *
 * Vrátí cached Todoist projekty (z TodoistProjectMirror) + sekce pro každý
 * projekt. Sekce nejsou v DB cached, takže pokud query param `?withSections=1`,
 * load z Todoist API on-demand (paralelně).
 *
 * Bez sekcí (default) = jeden DB query, instant. Pro picker projektu stačí.
 * Se sekcemi = pomalejší (n × Todoist API call), ale úplný picker.
 *
 * Response: {
 *   projects: [
 *     { id, name, color, isInbox, parentId, sections?: [{ id, name }] }
 *   ]
 * }
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const withSections = url.searchParams.get("withSections") === "1";

  const mirrors = await prisma.todoistProjectMirror.findMany({
    where: { userId: session.uid },
    select: {
      todoistId: true,
      name: true,
      color: true,
      isInbox: true,
      parentId: true,
      isTeamProject: true,
    },
    orderBy: [
      { isInbox: "desc" }, // Inbox první
      { name: "asc" },
    ],
  });

  const projects = mirrors.map((m) => ({
    id: m.todoistId,
    name: m.name,
    color: m.color,
    isInbox: m.isInbox,
    parentId: m.parentId,
    isTeam: m.isTeamProject,
  }));

  if (!withSections) {
    return Response.json({ projects });
  }

  // Se sekcemi — load on-demand paralelně z Todoist API.
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ projects, error: "Todoist integrace není nakonfigurovaná." });
  }
  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  const enriched = await Promise.all(
    projects.map(async (p) => {
      try {
        const sections = await listSections(token, p.id);
        return {
          ...p,
          sections: sections.map((s) => ({ id: s.id, name: s.name })),
        };
      } catch (e) {
        console.warn(`[projects-list] listSections fail for ${p.name}:`, e);
        return { ...p, sections: [] };
      }
    }),
  );

  return Response.json({ projects: enriched });
};
