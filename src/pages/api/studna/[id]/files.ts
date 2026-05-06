import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveProjectFile } from "@/lib/uploads";

export const prerender = false;

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB per soubor

/**
 * POST /api/studna/:id/files
 *   Owner-only. Multipart upload souboru jako přílohy projektu.
 *   Form fields: file (File), note (string, optional).
 *   Žádná AI analýza — soubor se jen uloží na disk + DB row.
 *
 * GET /api/studna/:id/files
 *   List všech souborů projektu (chronologicky desc).
 */

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid, archivedAt: null },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  const note = (form.get("note") as string | null)?.toString().trim() || null;

  if (!(file instanceof File)) {
    return Response.json({ error: "Chybí soubor." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const originalName = file.name || "soubor.bin";

  let saved;
  try {
    saved = await saveProjectFile(`project-files/${projectId}`, buf, mime, originalName);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Uložení selhalo." }, { status: 400 });
  }

  const row = await prisma.projectFile.create({
    data: {
      projectId,
      filename: saved.relativePath.split("/").pop()!,
      originalName,
      mime,
      bytes: saved.bytes,
      storagePath: saved.relativePath,
      note,
    },
  });

  return Response.json({ file: row });
};

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
    select: { id: true },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const files = await prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true, originalName: true, mime: true, bytes: true,
      note: true, uploadedAt: true,
    },
  });

  return Response.json({ files });
};
