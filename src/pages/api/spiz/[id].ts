import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * DELETE /api/spiz/:id
 *   Owner-only manuální smazání sdíleného souboru (před 14denní expirací).
 *   Smaže DB row + soubor na disku. Sdílený link okamžitě přestane fungovat.
 */
export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const f = await prisma.sharedFile.findFirst({
    where: { id, userId: session.uid },
  });
  if (!f) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await deleteUpload(f.storagePath);
  await prisma.sharedFile.delete({ where: { id } });

  return Response.json({ ok: true });
};
