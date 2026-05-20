import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { loadTimelineProject, listProjectOptions } from "@/lib/timeline/data-loader";

export const prerender = false;

/**
 * GET /api/timeline/:projectId
 *   Vrátí TimelineProject JSON pro vykreslení v UI.
 *
 * GET /api/timeline/list  (special projectId "list")
 *   Vrátí seznam projektů pro dropdown.
 *
 * Petr 2026-05-19 — read-only, žádná Todoist API volání (Q-C=A).
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const projectId = params.projectId;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  if (projectId === "list") {
    const options = await listProjectOptions(session.uid);
    return Response.json({ options });
  }

  // Petr 2026-05-20: multi-select — comma-separated IDs (např. "id1,id2,id3")
  const ids = projectId.includes(",") ? projectId.split(",").filter(Boolean) : projectId;
  const project = await loadTimelineProject(session.uid, ids);
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json({ project });
};
