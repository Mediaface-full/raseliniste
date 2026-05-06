import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * GET /api/spiz/d/:token
 *   Public download endpoint — kdokoli s tokenem může stáhnout (žádná auth).
 *   Inkrementuje downloadCount + lastDownloadAt. Pokud expirovalo nebo
 *   neexistuje, vrátí 404.
 */
export const GET: APIRoute = async ({ params }) => {
  const token = params.token;
  if (!token) return new Response("Bad request", { status: 400 });

  const f = await prisma.sharedFile.findUnique({ where: { token } });
  if (!f) return new Response("Soubor nenalezen nebo už byl smazán.", { status: 404 });
  if (f.expiresAt.getTime() < Date.now()) {
    return new Response("Tento odkaz vypršel (po 14 dnech).", { status: 410 });
  }

  let data: Buffer;
  try {
    data = await readUpload(f.storagePath);
  } catch {
    return new Response("Soubor zmizel z disku.", { status: 410 });
  }

  // Inkrementace download counteru — fire-and-forget, ať response není pomalé
  void prisma.sharedFile.update({
    where: { id: f.id },
    data: { downloadCount: { increment: 1 }, lastDownloadAt: new Date() },
  }).catch(() => null);

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": f.mime || "application/octet-stream",
      "content-length": String(data.byteLength),
      "content-disposition": `attachment; filename="${encodeURIComponent(f.originalName)}"`,
      "cache-control": "private, no-store",
    },
  });
};
