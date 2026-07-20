import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { processLabReportInBackground } from "@/lib/health-labs";

export const prerender = false;

const MAX_PDF_BYTES = 15 * 1024 * 1024;

/** GET /api/health/labs — seznam reportů (polling pro UI, à 4 s dokud processing) */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const reports = await prisma.healthLabReport.findMany({
    where: { userId: session.uid },
    orderBy: [{ sampledAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, filename: true, sampledAt: true, labName: true,
      status: true, processingError: true, createdAt: true,
      _count: { select: { results: true } },
    },
  });
  return Response.json({
    reports: reports.map((r) => ({
      id: r.id,
      filename: r.filename,
      sampledAt: r.sampledAt,
      labName: r.labName,
      status: r.status,
      processingError: r.processingError,
      createdAt: r.createdAt,
      resultCount: r._count.results,
    })),
  });
};

/** POST /api/health/labs — upload PDF (multipart "file"), fire-and-forget extrakce */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Chybí soubor (multipart field 'file')." }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Nahraj PDF soubor s výsledky." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) {
    return Response.json({ error: "PDF je větší než 15 MB." }, { status: 400 });
  }

  const saved = await saveUpload("health-labs", buf, "application/pdf");
  const report = await prisma.healthLabReport.create({
    data: {
      userId: session.uid,
      filename: file.name,
      pdfPath: saved.relativePath,
      pdfBytes: saved.bytes,
      status: "processing",
    },
  });

  processLabReportInBackground(report.id);
  return Response.json({ ok: true, reportId: report.id });
};
