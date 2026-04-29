import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { listAvailableSlots, evaluateSlot, type Slot } from "./rules";
import { createGoogleEvent } from "./google-calendar";
import { signMagicLink } from "./magic-link";
import { sendMail } from "./mailer";
import { env } from "./env";
import type { EventTypeStr } from "./event-classifier";

/**
 * Booking helpers — vytváření invite, listing slotů, rezervace, confirm.
 *
 * Klíčové datové modely:
 *   - BookingInvite: řádek v DB s tokenem; tři varianty:
 *     1. Personalizovaný (klient/přítel) — contactId vyplněno, předem víme komu
 *     2. Univerzální — contactId=null, inviteeName etc. NULL → klient se identifikuje
 *        při rezervaci. Token zůstává v DB jako multi-use placeholder; každá
 *        rezervace VYTVOŘÍ NOVÝ invite z template.
 *
 *   Univerzální = token "schuzka-univerzal" (deterministický, jeden v DB),
 *   nebo per-link kód generovaný pro každou kampaň. Brief mluví o "schuzka"
 *   public stránce — pojďme tou cestou.
 */

const APP_URL = () => env.APP_URL || "https://www.raseliniste.cz";

// ---------------------------------------------------------------------------
// Vytvoření invite
// ---------------------------------------------------------------------------

export type BookingModeStr = "CLIENT" | "FRIEND";
export type BookingMeetingTypeStr = "CHOICE_PRAGUE" | "CHOICE_ONLINE" | "CHOICE_HOME" | "CHOICE_ANY";

export interface CreateInviteInput {
  contactId?: string | null;        // null = univerzální / cold lead
  mode: BookingModeStr;
  meetingType: BookingMeetingTypeStr;
  slotDurationMin?: number;          // default 60
  validityDays?: number;             // default 14
  internalNote?: string;
}

export async function createInvite(input: CreateInviteInput): Promise<{
  invite: { id: string; token: string };
  url: string;
}> {
  const token = randomBytes(16).toString("base64url"); // 22 chars
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (input.validityDays ?? 14));

  // Pokud personalizovaný, načti kontakt pro snapshot
  let contactSnapshot: { name?: string; email?: string; phone?: string } = {};
  if (input.contactId) {
    const c = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { displayName: true, firstName: true, emails: true, phones: true },
    });
    if (!c) throw new Error("Kontakt nenalezen.");
    contactSnapshot = {
      name: c.firstName ?? c.displayName,
      email: c.emails[0]?.email,
      phone: c.phones[0]?.number,
    };
  }

  const invite = await prisma.bookingInvite.create({
    data: {
      token,
      mode: input.mode,
      meetingType: input.meetingType,
      contactId: input.contactId ?? null,
      slotDurationMin: input.slotDurationMin ?? 60,
      validUntil,
      internalNote: input.internalNote,
      status: "PENDING",
      // Snapshot vyplníme jen u univerzálního invite když ho použije cold lead
      // (vyplní se v reserveSlot). U personalizovaného známe od začátku.
      inviteeName: contactSnapshot.name,
      inviteeEmail: contactSnapshot.email,
      inviteePhone: contactSnapshot.phone,
    },
    select: { id: true, token: true },
  });

  return {
    invite,
    url: `${APP_URL()}/i/${token}`,
  };
}

// ---------------------------------------------------------------------------
// Listing slotů pro daný invite
// ---------------------------------------------------------------------------

export async function getSlotsForInvite(inviteId: string): Promise<{
  invite: NonNullable<Awaited<ReturnType<typeof prisma.bookingInvite.findUnique>>>;
  slots: Slot[];
}> {
  const invite = await prisma.bookingInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new Error("Invite nenalezen.");
  if (invite.status === "EXPIRED" || invite.status === "CANCELED") {
    return { invite, slots: [] };
  }
  if (invite.validUntil < new Date()) {
    return { invite, slots: [] };
  }

  const meetingTypes = mapMeetingType(invite.meetingType);
  const slots = await listAvailableSlots({
    meetingTypes,
    bookingMode: invite.mode as BookingModeStr,
    slotDurationMinutes: invite.slotDurationMin,
  });

  return { invite, slots };
}

function mapMeetingType(t: string): EventTypeStr[] {
  switch (t) {
    case "CHOICE_PRAGUE": return ["MEETING_PRAGUE"];
    case "CHOICE_ONLINE": return ["MEETING_ONLINE"];
    case "CHOICE_HOME": return ["MEETING_HOME"];
    case "CHOICE_ANY": return ["MEETING_PRAGUE", "MEETING_ONLINE", "MEETING_HOME"];
    default: return ["MEETING_ONLINE"];
  }
}

// ---------------------------------------------------------------------------
// Rezervace slotu (klient z /i/<token>)
// ---------------------------------------------------------------------------

export interface ReserveInput {
  inviteId: string;
  slot: { startsAt: Date; endsAt: Date; type: EventTypeStr };
  // Pro univerzální invite (contactId=null) klient musí poslat:
  inviteeName?: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  inviteeSubject?: string;
}

export const EVERGREEN_NOTE = "schuzka-public-evergreen";

export async function reserveSlot(input: ReserveInput): Promise<{
  inviteId: string;
  magicLink: string;
}> {
  const invite = await prisma.bookingInvite.findUnique({ where: { id: input.inviteId } });
  if (!invite) throw new Error("Invite nenalezen.");
  if (invite.validUntil < new Date()) throw new Error("Pozvánka už neplatí.");
  if (invite.status === "CONFIRMED" || invite.status === "CANCELED") {
    throw new Error("Pozvánka už byla zpracována.");
  }

  // Pokud univerzální invite, vyžaduje invitee údaje
  const needsIdentification = !invite.contactId && !invite.inviteeEmail;
  if (needsIdentification) {
    if (!input.inviteeName || !input.inviteeEmail) {
      throw new Error("Vyplň prosím jméno a e-mail.");
    }
  }

  // Re-evaluate slot na serveru — UI verdiktu nedůvěřujeme
  const evaluation = await evaluateSlot({
    type: input.slot.type,
    startsAt: input.slot.startsAt,
    endsAt: input.slot.endsAt,
    bookingMode: invite.mode as BookingModeStr,
  });
  if (evaluation.verdict === "RED") {
    throw new Error(`Slot už není dostupný: ${evaluation.signals[0]?.message ?? "konflikt"}`);
  }

  const isEvergreen = invite.internalNote === EVERGREEN_NOTE;
  const reservedSlotData = {
    startsAt: input.slot.startsAt.toISOString(),
    endsAt: input.slot.endsAt.toISOString(),
    type: input.slot.type,
  };

  // Pro evergreen (/schuzka) vytvoř KLON — originál zůstává PENDING pro další leady.
  // Pro běžný invite update na RESERVED.
  let updated: typeof invite;
  if (isEvergreen) {
    updated = await prisma.bookingInvite.create({
      data: {
        token: randomBytes(16).toString("base64url"),
        mode: invite.mode,
        meetingType: invite.meetingType,
        contactId: null,
        slotDurationMin: invite.slotDurationMin,
        validUntil: invite.validUntil,
        internalNote: `Z /schuzka (cold lead)`,
        status: "RESERVED",
        reservedSlot: reservedSlotData,
        inviteeName: input.inviteeName,
        inviteeEmail: input.inviteeEmail,
        inviteePhone: input.inviteePhone,
        inviteeSubject: input.inviteeSubject,
      },
    });
  } else {
    updated = await prisma.bookingInvite.update({
      where: { id: invite.id },
      data: {
        status: "RESERVED",
        reservedSlot: reservedSlotData,
        ...(needsIdentification && {
          inviteeName: input.inviteeName,
          inviteeEmail: input.inviteeEmail,
          inviteePhone: input.inviteePhone,
          inviteeSubject: input.inviteeSubject,
        }),
      },
    });
  }

  // Magic-link pro confirm
  const token = signMagicLink(updated.id);
  const magicLink = `${APP_URL()}/api/booking/confirm?t=${encodeURIComponent(token)}`;

  // Pošli klientovi mail s confirm linkem
  if (updated.inviteeEmail) {
    const dateStr = input.slot.startsAt.toLocaleDateString("cs-CZ", {
      weekday: "long", day: "numeric", month: "long",
    });
    const timeStr = `${fmtTime(input.slot.startsAt)}–${fmtTime(input.slot.endsAt)}`;
    const greeting = updated.inviteeName ? `Ahoj ${updated.inviteeName},` : "Ahoj,";

    await sendMail({
      to: updated.inviteeEmail,
      subject: `Potvrzení termínu — ${dateStr} ${timeStr}`,
      html: `
        <p>${greeting}</p>
        <p>chceš potvrdit termín <strong>${dateStr} ${timeStr}</strong>?</p>
        <p>Klikni pro potvrzení:</p>
        <p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:white;text-decoration:none;border-radius:6px;">Potvrdit termín</a></p>
        <p style="color:#666;font-size:12px;">Pokud klik nefunguje, otevři tento odkaz: ${magicLink}</p>
        <p style="color:#666;font-size:12px;">Odkaz platí 24 hodin. Pokud termín už nechceš, ignoruj tento mail.</p>
      `,
      text: `${greeting}\n\nchceš potvrdit termín ${dateStr} ${timeStr}?\n\nPotvrdit: ${magicLink}\n\n(Odkaz platí 24 hodin.)`,
    });
  }

  return { inviteId: updated.id, magicLink };
}

// ---------------------------------------------------------------------------
// Potvrzení (z magic-link mailu) — vytvoří Google event
// ---------------------------------------------------------------------------

export async function confirmReservation(inviteId: string, ownerUserId: string): Promise<{
  invite: { id: string; status: string };
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
}> {
  const invite = await prisma.bookingInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new Error("Pozvánka neexistuje.");
  if (invite.status === "CONFIRMED") {
    throw new Error("Termín už je potvrzený. Zkontroluj e-mail s potvrzením.");
  }
  if (invite.status !== "RESERVED" || !invite.reservedSlot) {
    throw new Error("Pozvánka není ve stavu rezervace. Začni od začátku.");
  }
  if (invite.validUntil < new Date()) throw new Error("Pozvánka už neplatí.");

  const slot = invite.reservedSlot as { startsAt: string; endsAt: string; type: string };
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);

  // Vytvoř event v Google
  const summary = invite.inviteeName
    ? `${slot.type === "MEETING_ONLINE" ? "🎥" : "🤝"} ${invite.inviteeName}${invite.inviteeSubject ? ` — ${invite.inviteeSubject}` : ""}`
    : `🤝 Schůzka${invite.inviteeSubject ? ` — ${invite.inviteeSubject}` : ""}`;

  const description = [
    invite.inviteeSubject ? `**Téma:** ${invite.inviteeSubject}` : "",
    invite.inviteeEmail ? `**E-mail:** ${invite.inviteeEmail}` : "",
    invite.inviteePhone ? `**Telefon:** ${invite.inviteePhone}` : "",
    invite.internalNote ? `**Poznámka:** ${invite.internalNote}` : "",
    "",
    `_Vytvořeno z bookingu Rašeliniště._`,
  ].filter(Boolean).join("\n");

  const result = await createGoogleEvent(ownerUserId, {
    summary,
    description,
    startsAt,
    endsAt,
    attendeeEmails: invite.inviteeEmail ? [invite.inviteeEmail] : undefined,
    conferenceData: slot.type === "MEETING_ONLINE",
  });

  const updated = await prisma.bookingInvite.update({
    where: { id: invite.id },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  // Mail klientovi: potvrzení + Meet link
  if (invite.inviteeEmail) {
    const dateStr = startsAt.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
    const timeStr = `${fmtTime(startsAt)}–${fmtTime(endsAt)}`;
    const meetSection = result.meetLink
      ? `<p><strong>Google Meet odkaz:</strong> <a href="${result.meetLink}">${result.meetLink}</a></p>`
      : slot.type === "MEETING_PRAGUE"
        ? `<p><strong>Místo:</strong> Praha — přesnou adresu pošlu samostatně.</p>`
        : slot.type === "MEETING_HOME"
          ? `<p><strong>Místo:</strong> u mě doma — adresu pošlu samostatně.</p>`
          : "";

    await sendMail({
      to: invite.inviteeEmail,
      subject: `Potvrzeno: ${dateStr} ${timeStr}`,
      html: `
        <p>Ahoj${invite.inviteeName ? ` ${invite.inviteeName}` : ""},</p>
        <p>termín <strong>${dateStr} ${timeStr}</strong> je potvrzený. ✓</p>
        ${meetSection}
        <p>Pozvánka přijde i samostatně z Google Calendar.</p>
        <p>Těším se,<br/>Petr</p>
      `,
      text: `Ahoj${invite.inviteeName ? ` ${invite.inviteeName}` : ""},\n\ntermín ${dateStr} ${timeStr} je potvrzený.\n${result.meetLink ? `\nMeet: ${result.meetLink}\n` : ""}\nTěším se,\nPetr`,
    });
  }

  return {
    invite: { id: updated.id, status: updated.status },
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    meetLink: result.meetLink,
  };
}

// ---------------------------------------------------------------------------
// Cancel (admin)
// ---------------------------------------------------------------------------

export async function cancelInvite(inviteId: string): Promise<void> {
  const invite = await prisma.bookingInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new Error("Pozvánka neexistuje.");

  await prisma.bookingInvite.update({
    where: { id: inviteId },
    data: { status: "CANCELED" },
  });

  // Pokud měla email, pošli cancellation
  if (invite.inviteeEmail && (invite.status === "RESERVED" || invite.status === "CONFIRMED")) {
    await sendMail({
      to: invite.inviteeEmail,
      subject: "Termín zrušen",
      html: `
        <p>Ahoj${invite.inviteeName ? ` ${invite.inviteeName}` : ""},</p>
        <p>termín bohužel musím zrušit. Omlouvám se za komplikace — pošli mi novou pozvánku, najdeme jiný čas.</p>
        <p>Petr</p>
      `,
      text: `Ahoj${invite.inviteeName ? ` ${invite.inviteeName}` : ""},\n\ntermín bohužel musím zrušit. Omlouvám se. Najdeme nový čas.\n\nPetr`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}
