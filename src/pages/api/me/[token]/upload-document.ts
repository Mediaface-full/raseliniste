import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/uploads";
import { detectDocKind, parseDocument } from "@/lib/document-parser";
import { indexEntity } from "@/lib/rag";

export const prerender = false;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB pro dokumenty (vetsi než stačí, PDF s scany)
const RATE_LIMIT_PER_GUEST = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/me/:token/upload-document
 *
 * Petr 2026-06-19: Studánka host nahrává dokument (PDF/DOCX/XLSX/TXT) vedle
 * audio. Soubor:
 *   1) Validace MIME a velikosti
 *   2) Vyžadujeme invitation.canUploadAudio=true (sdíleny flag s audio uploadem —
 *      kdo má dovoleno uploadovat audio má i dokumenty)
 *   3) Uložení na disk + ProjectFile záznam (status "pending")
 *   4) Fire-and-forget: parser → extractedText → status "ok" → RAG indexace
 *      jako sourceType "project-document" do projektové znalostní báze
 *
 *   Form fields: projectId, file
 *
 * Vrací: { ok, fileId, originalName, kind } — sync, extrakce na pozadí
 */
export const POST: APIRoute = async ({ request, params }) => {
  const token = params.token;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const guest = await prisma.guestUser.findUnique({ where: { guestToken: token } });
  if (!guest) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Rate limit per host (sdílí budget s recording uploads — počítá obojí)
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentDocs = await prisma.projectFile.count({
    where: { guestUserId: guest.id, uploadedAt: { gte: since } },
  });
  if (recentDocs >= RATE_LIMIT_PER_GUEST) {
    return Response.json(
      { error: `Limit ${RATE_LIMIT_PER_GUEST} dokumentů/hodinu vyčerpán. Zkus to za chvíli.` },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const file = form.get("file");
  if (!projectId) return Response.json({ error: "INVALID_PROJECT" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "Chybí soubor." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "Soubor je prázdný." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Soubor je moc velký (max ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  // Authorize against invitation (canUploadAudio == permission to upload anything)
  const inv = await prisma.projectInvitation.findFirst({
    where: { guestUserId: guest.id, projectId },
    include: { project: { select: { id: true, userId: true, archivedAt: true } } },
  });
  if (!inv || !inv.project || inv.project.archivedAt) {
    return Response.json({ error: "Projekt neexistuje nebo nemáš oprávnění." }, { status: 403 });
  }
  if (!inv.canUploadAudio) {
    return Response.json(
      { error: "Tento projekt nepovoluje nahrávání souborů. Kontaktuj Gideona." },
      { status: 403 },
    );
  }

  // Detect kind + validace
  const kind = detectDocKind(file.type || "application/octet-stream", file.name);
  if (kind === "unknown") {
    return Response.json(
      { error: `Nepodporovaný typ: ${file.type || file.name}. Povolené: PDF, DOCX, XLSX, TXT.` },
      { status: 415 },
    );
  }

  // Save to disk pomocí helperu (uloží do podadresáře "project-documents")
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeForSave = file.type || `application/${kind}`;
  const saved = await saveUpload("project-documents", buffer, mimeForSave);

  // Create DB record (pending extraction)
  const created = await prisma.projectFile.create({
    data: {
      projectId,
      guestUserId: guest.id,
      filename: saved.relativePath.split("/").pop() ?? "unknown",
      originalName: file.name,
      mime: mimeForSave,
      bytes: file.size,
      storagePath: saved.relativePath,
      extractionStatus: "pending",
    },
  });

  // Fire-and-forget: parse + RAG index
  void (async () => {
    const ownerUserId = inv.project!.userId;
    try {
      const parsed = await parseDocument(buffer, file.type || "", file.name);
      await prisma.projectFile.update({
        where: { id: created.id },
        data: {
          extractionStatus: "ok",
          extractedText: parsed.text,
          extractionError: parsed.truncated
            ? `Text zkrácen na ${100_000} znaků`
            : null,
        },
      });

      // RAG index — dokument se zařadí do znalostní báze projektu
      const ragText = [
        `# ${file.name}`,
        `Projekt: ${inv.project!.id}`,
        `Nahráno hostem: ${guest.name}`,
        "",
        parsed.text,
      ].join("\n");
      void indexEntity({
        userId: ownerUserId,
        sourceType: "project-document",
        sourceId: created.id,
        text: ragText,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.projectFile.update({
        where: { id: created.id },
        data: { extractionStatus: "error", extractionError: msg.slice(0, 500) },
      });
      console.warn(`[upload-document] extract failed for ${created.id}:`, msg);
    }
  })();

  return Response.json({
    ok: true,
    fileId: created.id,
    originalName: file.name,
    kind,
    bytes: file.size,
  });
};
