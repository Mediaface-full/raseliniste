import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveProjectFile } from "@/lib/uploads";

export const prerender = false;

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB — share může být velký
const RETENTION_DAYS = 14;

function makeToken(): string {
  return randomBytes(18).toString("base64url"); // 24 znaků, ~144 bit entropie
}

/**
 * POST /api/spiz/upload
 *   Owner-only multipart upload souboru pro veřejné sdílení.
 *   Form: file (File). Vrátí { token, shareUrl, expiresAt }.
 *   Po 14 dnech cron `cleanup-spiz` soubor smaže.
 */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const originalName = file.name || "soubor.bin";

  let saved;
  try {
    saved = await saveProjectFile("spiz", buf, mime, originalName);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Uložení selhalo." }, { status: 400 });
  }

  // Token unique — retry pokud kolize (extrémně nepravděpodobné)
  let token = makeToken();
  for (let i = 0; i < 3; i++) {
    const exists = await prisma.sharedFile.findUnique({ where: { token }, select: { id: true } });
    if (!exists) break;
    token = makeToken();
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const row = await prisma.sharedFile.create({
    data: {
      userId: session.uid,
      token,
      filename: saved.relativePath.split("/").pop()!,
      originalName,
      mime,
      bytes: saved.bytes,
      storagePath: saved.relativePath,
      uploadedAt: now,
      expiresAt,
    },
  });

  const origin = url.origin;
  return Response.json({
    file: {
      id: row.id,
      token: row.token,
      originalName: row.originalName,
      bytes: row.bytes,
      uploadedAt: row.uploadedAt,
      expiresAt: row.expiresAt,
      downloadCount: row.downloadCount,
    },
    shareUrl: `${origin}/g/${token}`,
  });
};
