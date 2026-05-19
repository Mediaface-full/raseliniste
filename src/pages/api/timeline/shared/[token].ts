import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { loadTimelineProject } from "@/lib/timeline/data-loader";

export const prerender = false;

/**
 * GET /api/timeline/shared/:token  (PUBLIC, no auth)
 *
 * Read-only data pro share view. Pokud expired nebo revoked → 404.
 */
export const GET: APIRoute = async ({ params }) => {
  const token = params.token;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const share = await prisma.sharedTimeline.findUnique({
    where: { token },
  });

  if (!share) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (share.revokedAt) return Response.json({ error: "REVOKED" }, { status: 410 });
  if (share.expiresAt < new Date()) return Response.json({ error: "EXPIRED" }, { status: 410 });

  // Načti projekt skrz share.userId (owner)
  const project = await loadTimelineProject(share.userId, share.projectId);
  if (!project) return Response.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });

  return Response.json({
    project,
    sharedAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
  });
};
