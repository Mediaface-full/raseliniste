import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload, readUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * GET    /api/studna/files/:fileId  → stáhnout soubor (Content-Disposition: attachment)
 * DELETE /api/studna/files/:fileId  → smazat (DB row + soubor na disku)
 *
 * Owner-only.
 */

async function loadOwnedFile(userId: string, fileId: string) {
  return prisma.projectFile.findFirst({
    where: { id: fileId, project: { userId } },
  });
}

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const fileId = params.fileId;
  if (!fileId) return new Response("Bad request", { status: 400 });

  const f = await loadOwnedFile(session.uid, fileId);
  if (!f) return new Response("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await readUpload(f.storagePath);
  } catch {
    return new Response("Soubor zmizel z disku", { status: 410 });
  }

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

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const fileId = params.fileId;
  if (!fileId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const f = await loadOwnedFile(session.uid, fileId);
  if (!f) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await deleteUpload(f.storagePath);
  await prisma.projectFile.delete({ where: { id: fileId } });

  return Response.json({ ok: true });
};
