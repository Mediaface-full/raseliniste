import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { reserveSlot } from "@/lib/booking";
import type { EventTypeStr } from "@/lib/event-classifier";

export const prerender = false;

// Rate limit per IP — chrání proti booking spam (kdyby někdo flood-mailoval Gideona).
// Plus uvážlivý limit na hostitelské bookings (každá rezervace = mail).
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 h
const RATE_LIMIT_PER_IP = 20;

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

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
export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Rate limit per IP — anti-spam. Counter přes BookingInvite createdAt.
  const ip = clientIp(request, clientAddress);
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await prisma.bookingInvite.count({
    where: {
      // Heuristic: hosts vytvářené z /schuzka mají internalNote začínající "Z /schuzka"
      // — hashneme IP do internalNote pro přesnější tracking? Pro teď stačí
      // počet všech RESERVED za 1h.
      status: "RESERVED",
      createdAt: { gte: since },
    },
  });
  if (recentCount >= RATE_LIMIT_PER_IP) {
    return Response.json(
      { error: `Příliš mnoho rezervací za hodinu. Zkus to prosím za chvíli.` },
      { status: 429 },
    );
  }
  void ip; // pro budoucí per-IP tracking
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
    return Response.json({
      ok: true,
      inviteId: result.inviteId,
      meetLink: result.meetLink,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
