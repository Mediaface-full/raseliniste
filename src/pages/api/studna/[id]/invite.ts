import type { APIRoute } from "astro";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { env } from "@/lib/env";

export const prerender = false;

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).nullable().optional(),
  canRecordBrief: z.boolean().optional(),
  keepAudio: z.boolean().optional(),
  canUploadAudio: z.boolean().optional(),
});

function makeGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * POST /api/studna/:id/invite
 *   Pozvi přispěvatele do projektu. Pokud GuestUser s daným emailem ještě
 *   neexistuje (per owner), vytvoří se. Jinak se k němu jen přidá invitation.
 *
 *   Vrátí URL pro Karla: /me/<guestToken>
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const projectId = params.id;
  if (!projectId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const project = await prisma.projectBox.findFirst({
    where: { id: projectId, userId: session.uid },
  });
  if (!project) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  // Najdi nebo vytvoř GuestUser podle (ownerUserId, email)
  let guest = await prisma.guestUser.findUnique({
    where: {
      ownerUserId_email: { ownerUserId: session.uid, email: body.email.toLowerCase() },
    },
  });

  if (!guest) {
    guest = await prisma.guestUser.create({
      data: {
        ownerUserId: session.uid,
        email: body.email.toLowerCase(),
        name: body.name,
        phone: body.phone ?? null,
        guestToken: makeGuestToken(),
      },
    });
  } else {
    // Pokud existuje, můžeme aktualizovat jméno / telefon (uživatel může opravit překlep)
    guest = await prisma.guestUser.update({
      where: { id: guest.id },
      data: {
        name: body.name,
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
    });
  }

  // Upsert invitation
  const invitation = await prisma.projectInvitation.upsert({
    where: {
      projectId_guestUserId: { projectId, guestUserId: guest.id },
    },
    create: {
      projectId,
      guestUserId: guest.id,
      canRecordBrief: body.canRecordBrief ?? false,
      keepAudio: body.keepAudio ?? false,
      canUploadAudio: body.canUploadAudio ?? false,
    },
    update: {
      canRecordBrief: body.canRecordBrief ?? false,
      ...(body.keepAudio !== undefined ? { keepAudio: body.keepAudio } : {}),
      ...(body.canUploadAudio !== undefined ? { canUploadAudio: body.canUploadAudio } : {}),
    },
  });

  // Server zevnitř kontejneru vidí request.url jako localhost:3000.
  // Použij APP_URL z .env (canonical) nebo X-Forwarded-Host fallback.
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl =
    env.APP_URL ??
    (fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin);
  const link = `${baseUrl.replace(/\/$/, "")}/me/${guest.guestToken}`;

  return Response.json({
    ok: true,
    guest: {
      id: guest.id,
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      guestToken: guest.guestToken,
    },
    invitation,
    link,
  });
};
