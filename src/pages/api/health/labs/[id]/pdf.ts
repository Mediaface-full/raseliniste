import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload } from "@/lib/uploads";

export const prerender = false;

/** GET /api/health/labs/:id/pdf — originální PDF (dohledatelnost extrakce) */
export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const report = await prisma.healthLabReport.findFirst({
    where: { id: params.id, userId: session.uid },
    select: { pdfPath: true, filename: true },
  });
  if (!report) return Response.json({ error: "Report nenalezen." }, { status: 404 });

  try {
    const buf = await readUpload(report.pdfPath);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${encodeURIComponent(report.filename)}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "PDF soubor na disku chybí." }, { status: 404 });
  }
};
