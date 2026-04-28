import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readSession } from "@/lib/session";
import { resolveUpload } from "@/lib/uploads";
import { prisma } from "@/lib/db";

export const prerender = false;

/**
 * GET /api/uploads/<relpath>
 *   Vrátí soubor z uploads/. Auth: session.
 *   Ověří ownership: soubor patří některému objektu uživatele.
 *   Path traversal blokován (žádné ".." segmenty).
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rawPath = Array.isArray(params.path)
    ? params.path.join("/")
    : (params.path as string | undefined) ?? "";

  // Bezpečnost — žádné ".." nebo absolutní cesty
  if (!rawPath || rawPath.includes("..") || rawPath.startsWith("/")) {
    return new Response("Bad path", { status: 400 });
  }

  // Ověř, že tahle cesta patří k některému objektu uživatele
  const ownsLogo = await prisma.letterSender.findFirst({
    where: { userId: session.uid, OR: [{ logoPath: rawPath }, { signaturePath: rawPath }] },
    select: { id: true },
  });
  const ownsLetterPdf = !ownsLogo
    ? await prisma.letter.findFirst({
        where: { userId: session.uid, pdfPath: rawPath },
        select: { id: true },
      })
    : null;

  if (!ownsLogo && !ownsLetterPdf) {
    return new Response("Forbidden", { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(resolveUpload(rawPath));
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(rawPath).toLowerCase();
  const ctype =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".pdf"
            ? "application/pdf"
            : "application/octet-stream";

  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": ctype,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
};
