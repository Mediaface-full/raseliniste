import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { renderOnboardingPdf } from "@/lib/onboarding-pdf";

export const prerender = false;

/**
 * GET /api/studna/:id/onboarding/:guestId/:variant.pdf
 *   Stáhne PDF s návodem pro hosta.
 *   variant: "standard" nebo "brief"
 *
 *   Vlastník (Petr) si tohle stáhne a pošle hostovi e-mailem.
 */
export const GET: APIRoute = async ({ cookies, params, request }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const projectId = params.id;
  const guestId = params.guestId;
  const variantRaw = String(params.variant ?? "");
  const variant = variantRaw.replace(/\.pdf$/i, "") as "standard" | "brief";

  if (!projectId || !guestId) return new Response("Bad request", { status: 400 });
  if (variant !== "standard" && variant !== "brief") {
    return new Response("Variant must be 'standard' or 'brief'", { status: 400 });
  }

  // Ownership check
  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
  });
  if (!project) return new Response("Not found", { status: 404 });

  const guest = await prisma.guestUser.findFirst({
    where: { id: guestId, ownerUserId: session.uid },
  });
  if (!guest) return new Response("Not found", { status: 404 });

  const baseUrl = new URL(request.url).origin;
  const inviteLink = `${baseUrl}/me/${guest.guestToken}`;

  const pdfBuf = await renderOnboardingPdf(variant, {
    guestName: guest.name,
    projectName: project.name,
    projectDescription: project.description,
    inviteLink,
  });

  const safeProj = project.name.replace(/[^a-zA-Z0-9-_.]/g, "_").slice(0, 30);
  const safeGuest = guest.name.replace(/[^a-zA-Z0-9-_.]/g, "_").slice(0, 30);
  const filename = `studna-${variant}-${safeProj}-${safeGuest}.pdf`;

  const bytes = new Uint8Array(pdfBuf.buffer, pdfBuf.byteOffset, pdfBuf.byteLength);
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfBuf.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
