import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/booking/:id/diagnose  (Petr 2026-05-25)
 *
 * Vrátí kompletní řetězec dat pro debugování „proč host nedostal mail":
 *   - BookingInvite: status, inviteeEmail, meetLink, googleEventId
 *   - Contact (pokud personalizovaná): aktuální emails[0] z DB
 *   - reservedSlot: startsAt/endsAt/type
 *   - MailLog: všechny záznamy pro tento inviteeEmail za posledních 30 dní
 *     (filtrované na context booking-* a obecně subject "Termín")
 *   - CalendarEvent: jestli existuje sync záznam pro googleEventId
 *
 * Žádné side effects — pure read. Slouží Petrovi když přijde stížnost
 * „nepřišlo mi nic". Z odpovědi rovnou pozná:
 *   - jestli mail šel (MailLog ok=true) → problém u příjemce (spam/filtr)
 *   - jestli šel s chybou (ok=false, error) → SMTP/Resend problém
 *   - jestli vůbec nešel (žádný MailLog) → invite nemá email nebo se nezavolalo
 *   - jestli má Meet link (meetLink !== null) → Google event vznikl správně
 */
export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const invite = await prisma.bookingInvite.findUnique({
    where: { id },
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
          emails: { select: { email: true, label: true } },
        },
      },
    },
  });
  if (!invite) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const slotJson = invite.reservedSlot as { startsAt?: string; endsAt?: string; type?: string } | null;

  // MailLog — všechny záznamy pro inviteeEmail (snapshot i aktuální z Contact)
  // za posledních 30 dní.
  const emailCandidates = [
    invite.inviteeEmail,
    invite.contact?.emails?.[0]?.email,
  ].filter((e): e is string => !!e);
  const uniqueEmails = Array.from(new Set(emailCandidates));

  const mailLogs = uniqueEmails.length > 0
    ? await prisma.mailLog.findMany({
        where: {
          to: { in: uniqueEmails },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  // CalendarEvent — sync záznam pro Google event (existuje pokud kalendář sync proběhl)
  const calendarEvent = invite.googleEventId
    ? await prisma.calendarEvent.findFirst({
        where: { externalId: invite.googleEventId, source: "GOOGLE_PRIMARY" },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          sourceUrl: true,
          lastSyncedAt: true,
          deletedRemotely: true,
        },
      })
    : null;

  // Verdict — automatická diagnóza co se stalo
  const verdict: string[] = [];
  if (!invite.inviteeEmail) {
    verdict.push("⚠ inviteeEmail je null — mail se PŘESKOČIL při confirmReservation");
  }
  if (invite.status === "CONFIRMED" && !invite.meetLink && slotJson?.type === "MEETING_ONLINE") {
    verdict.push("⚠ MEETING_ONLINE bez meetLink — Google conferenceData asi selhal");
  }
  if (invite.status === "CONFIRMED" && !invite.googleEventId) {
    verdict.push("⚠ CONFIRMED ale bez googleEventId — buď legacy invite (před 2026-05-25), nebo createGoogleEvent selhal");
  }
  const confirmLogs = mailLogs.filter((l) => l.context?.startsWith("booking-"));
  if (invite.status === "CONFIRMED" && confirmLogs.length === 0) {
    verdict.push("⚠ CONFIRMED ale žádný booking-* MailLog záznam — mail vůbec neodjel z naší strany");
  }
  const failedLogs = confirmLogs.filter((l) => !l.ok);
  if (failedLogs.length > 0) {
    verdict.push(`⚠ ${failedLogs.length} mail-send pokus selhal (viz mailLogs[].error)`);
  }
  const okLogs = confirmLogs.filter((l) => l.ok);
  if (okLogs.length > 0 && verdict.length === 0) {
    verdict.push(`${okLogs.length} mail úspěšně odešel přes ${okLogs.map((l) => l.provider).join(",")} — pokud host tvrdí že nedostal, problém je u něj (spam, server filtr)`);
  }

  return Response.json({
    invite: {
      id: invite.id,
      status: invite.status,
      mode: invite.mode,
      meetingType: invite.meetingType,
      inviteeName: invite.inviteeName,
      inviteeEmail: invite.inviteeEmail,
      inviteePhone: invite.inviteePhone,
      inviteeSubject: invite.inviteeSubject,
      meetLink: invite.meetLink,
      googleEventId: invite.googleEventId,
      createdAt: invite.createdAt,
      confirmedAt: invite.confirmedAt,
      validUntil: invite.validUntil,
    },
    reservedSlot: slotJson,
    contact: invite.contact
      ? {
          id: invite.contact.id,
          displayName: invite.contact.displayName,
          currentEmails: invite.contact.emails,
          snapshotEmailMatchesCurrent: invite.contact.emails[0]?.email === invite.inviteeEmail,
        }
      : null,
    calendarEvent,
    mailLogs: mailLogs.map((l) => ({
      createdAt: l.createdAt,
      to: l.to,
      subject: l.subject,
      provider: l.provider,
      ok: l.ok,
      context: l.context,
      providerId: l.providerId,
      error: l.error,
    })),
    verdict,
  });
};
