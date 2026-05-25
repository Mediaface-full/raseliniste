import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { sendMail } from "@/lib/mailer";
import { buildBookingConfirmMail } from "@/lib/booking";

export const prerender = false;

const Body = z.object({
  email: z.string().trim().email().optional(),  // Petr může overridnout
});

/**
 * POST /api/booking/:id/resend
 *
 * Znovu odeslání potvrzovacího mailu pro CONFIRMED/RESERVED pozvánku.
 *
 * Petr 2026-05-25: dřív posílal placeholder „Pokud máme Google Meet link,
 * najdeš ho v kalendářové pozvánce z Google." — což bylo k ničemu, když
 * Google nativní invite skončil ve spamu. Teď posílá:
 *   - skutečný Meet link (z BookingInvite.meetLink persistovaný v confirmReservation)
 *   - .ics attachment (host si přidá do libovolného kalendáře nezávisle na Google)
 *
 * Sdílí build helper s confirmReservation() v src/lib/booking.ts — jeden zdroj
 * pravdy pro formát mailu.
 *
 * Body (volitelně): { email } pro override pokud invite snapshot je null.
 * Pokud email v body i v invite chybí → 400.
 */
export const POST: APIRoute = async ({ request, params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const invite = await prisma.bookingInvite.findUnique({
    where: { id },
    include: {
      contact: { select: { displayName: true, firstName: true, lastName: true, emails: true } },
    },
  });
  if (!invite) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (invite.status !== "CONFIRMED" && invite.status !== "RESERVED") {
    return Response.json(
      { error: `Mail lze poslat jen pro CONFIRMED/RESERVED pozvánky. Tahle má status ${invite.status}.` },
      { status: 400 },
    );
  }
  // reservedSlot je JSON sloupec (ne relation) — { startsAt, endsAt, type }
  const slotJson = invite.reservedSlot as { startsAt?: string; endsAt?: string; type?: string } | null;
  if (!slotJson?.startsAt || !slotJson?.endsAt || !slotJson?.type) {
    return Response.json({ error: "Pozvánka nemá platný rezervovaný slot." }, { status: 400 });
  }

  // Priorita pro email:
  // 1. Override z body (Petr ručně zadal)
  // 2. Aktuální Contact.emails[0] (pokud Petr doplnil email po vytvoření invite)
  // 3. Snapshot z BookingInvite.inviteeEmail
  const overrideEmail = parsed.data.email;
  const currentContactEmail = invite.contact?.emails?.[0]?.email;
  const snapshotEmail = invite.inviteeEmail;
  const targetEmail = overrideEmail ?? currentContactEmail ?? snapshotEmail ?? null;

  if (!targetEmail) {
    return Response.json(
      {
        error: "Žádný email k odeslání. Doplň email v Contacts pro kontakt, nebo přidej `email` do body requestu.",
      },
      { status: 400 },
    );
  }

  // Pokud email získán mimo snapshot (override/contact refresh), updatni
  // snapshot v BookingInvite pro budoucí konzistenci.
  if (targetEmail !== snapshotEmail) {
    await prisma.bookingInvite.update({
      where: { id },
      data: { inviteeEmail: targetEmail },
    });
  }

  const startsAt = new Date(slotJson.startsAt);
  const endsAt = new Date(slotJson.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return Response.json({ error: "reservedSlot.startsAt/endsAt není platný datum." }, { status: 400 });
  }

  const mail = buildBookingConfirmMail({
    startsAt,
    endsAt,
    slotType: slotJson.type,
    meetLink: invite.meetLink, // persistovaný z confirmReservation
    inviteeName: invite.inviteeName,
    inviteeEmail: targetEmail,
    inviteeSubject: invite.inviteeSubject,
  });

  const result = await sendMail({
    to: targetEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    context: "booking-confirm-resend",
    attachments: [
      {
        filename: "schuzka.ics",
        content: mail.ics,
        contentType: "text/calendar; charset=utf-8; method=REQUEST",
        encoding: "utf-8",
      },
    ],
  });

  return Response.json({
    ok: result.ok,
    sentTo: targetEmail,
    meetLink: invite.meetLink,
    hasMeetLink: !!invite.meetLink,
    provider: result.ok ? result.provider : null,
    providerId: result.ok ? result.id ?? null : null,
    error: result.ok ? null : result.error,
  });
};
