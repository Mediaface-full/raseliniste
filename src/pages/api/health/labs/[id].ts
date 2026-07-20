import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";
import { processLabReportInBackground } from "@/lib/health-labs";

export const prerender = false;

/** GET /api/health/labs/:id — detail s hodnotami */
export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const report = await prisma.healthLabReport.findFirst({
    where: { id: params.id, userId: session.uid },
    include: { results: { orderBy: { analyte: "asc" } } },
  });
  if (!report) return Response.json({ error: "Report nenalezen." }, { status: 404 });
  return Response.json({ report });
};

/** POST /api/health/labs/:id — re-run extrakce (po chybě) */
export const POST: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const report = await prisma.healthLabReport.findFirst({
    where: { id: params.id, userId: session.uid },
    select: { id: true },
  });
  if (!report) return Response.json({ error: "Report nenalezen." }, { status: 404 });

  await prisma.healthLabReport.update({
    where: { id: report.id },
    data: { status: "processing", processingError: null },
  });
  processLabReportInBackground(report.id);
  return Response.json({ ok: true });
};

/** DELETE /api/health/labs/:id — smaže report, hodnoty (CASCADE) i PDF */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const report = await prisma.healthLabReport.findFirst({
    where: { id: params.id, userId: session.uid },
    select: { id: true, pdfPath: true },
  });
  if (!report) return Response.json({ error: "Report nenalezen." }, { status: 404 });

  await prisma.healthLabReport.delete({ where: { id: report.id } });
  await deleteUpload(report.pdfPath);
  return Response.json({ ok: true });
};
