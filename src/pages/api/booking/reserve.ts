import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { reserveSlot } from "@/lib/booking";
import type { EventTypeStr } from "@/lib/event-classifier";

export const prerender = false;

const schema = z.object({
  token: z.string().min(1),
  slot: z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    type: z.enum(["MEETING_PRAGUE", "MEETING_ONLINE", "MEETING_HOME", "MEETING_ELSEWHERE"]),
  }),
  // Pro univerzální invite (cold lead identifikace)
  inviteeName: z.string().min(1).max(100).optional(),
  inviteeEmail: z.string().email().optional(),
  inviteePhone: z.string().max(50).optional(),
  inviteeSubject: z.string().max(300).optional(),
});

/**
 * POST /api/booking/reserve — public, klient zarezervuje slot
 * Pošle magic-link mail klientovi pro confirmation.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const invite = await prisma.bookingInvite.findUnique({
    where: { token: parsed.data.token },
  });
  if (!invite) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const result = await reserveSlot({
      inviteId: invite.id,
      slot: {
        startsAt: new Date(parsed.data.slot.startsAt),
        endsAt: new Date(parsed.data.slot.endsAt),
        type: parsed.data.slot.type as EventTypeStr,
      },
      inviteeName: parsed.data.inviteeName,
      inviteeEmail: parsed.data.inviteeEmail,
      inviteePhone: parsed.data.inviteePhone,
      inviteeSubject: parsed.data.inviteeSubject,
    });
    return Response.json({ ok: true, inviteId: result.inviteId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
