import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/spiz
 *   Owner-only list všech sdílených souborů z posledních 14 dní (= ne-expirovaných).
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const now = new Date();
  const files = await prisma.sharedFile.findMany({
    where: { userId: session.uid, expiresAt: { gt: now } },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true, token: true, originalName: true, mime: true, bytes: true,
      uploadedAt: true, expiresAt: true, downloadCount: true, lastDownloadAt: true,
    },
  });

  return Response.json({ files });
};
