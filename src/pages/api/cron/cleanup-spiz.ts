import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * Spíž — denní cleanup expirovaných sdílených souborů.
 *
 * Synology Task Scheduler:
 *   - Denně 03:10
 *   - curl -X POST https://www.raseliniste.cz/api/cron/cleanup-spiz
 *          -H "x-cron-key: <CRON_SECRET>"
 *
 * Logika: SharedFile.expiresAt < now → smaže soubor z disku + DB row.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const expired = await prisma.sharedFile.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, storagePath: true, originalName: true },
  });

  let deleted = 0;
  for (const f of expired) {
    await deleteUpload(f.storagePath);
    await prisma.sharedFile.delete({ where: { id: f.id } }).catch(() => null);
    deleted++;
  }

  return Response.json({ ok: true, deleted, scanned: expired.length });
};
