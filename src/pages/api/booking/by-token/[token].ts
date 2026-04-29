import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { getSlotsForInvite } from "@/lib/booking";

export const prerender = false;

/**
 * GET /api/booking/by-token/:token — public, klient otevře link
 * Vrátí detail invite + dostupné sloty.
 */
export const GET: APIRoute = async ({ params }) => {
  const token = params.token as string;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const invite = await prisma.bookingInvite.findUnique({ where: { token } });
  if (!invite) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Označit VIEWED pokud byl PENDING
  if (invite.status === "PENDING") {
    await prisma.bookingInvite.update({
      where: { id: invite.id },
      data: { status: "VIEWED" },
    });
  }

  const result = await getSlotsForInvite(invite.id);
  return Response.json({
    invite: {
      id: result.invite.id,
      mode: result.invite.mode,
      meetingType: result.invite.meetingType,
      slotDurationMin: result.invite.slotDurationMin,
      status: result.invite.status,
      validUntil: result.invite.validUntil,
      // Pre-fill když známe (personalizovaný invite)
      inviteeName: result.invite.inviteeName,
      inviteeEmail: result.invite.inviteeEmail,
      requiresIdentification: !result.invite.contactId && !result.invite.inviteeEmail,
    },
    slots: result.slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      type: s.type,
    })),
  });
};
