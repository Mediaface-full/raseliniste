import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { listAvailableSlots, evaluateSlot, type Slot } from "./rules";
import { createGoogleEvent } from "./google-calendar";
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
      select: { displayName: true, firstName: true, lastName: true, emails: true, phones: true },
    });
    if (!c) throw new Error("Kontakt nenalezen.");
    // Petr 2026-05-19: bug — předtím `c.firstName ?? c.displayName` brala jen
    // křestní jméno (kalendář pak ukázal "🤝 Jan" místo "🤝 Jan Novák").
    // Priorita: displayName (typicky "Jméno Příjmení") → firstName+lastName join
    // → firstName fallback. To dá v kalendáři čitelný plný název.
    const fullFromParts = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    contactSnapshot = {
      name: c.displayName?.trim() || fullFromParts || c.firstName || undefined,
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
  meetLink: string | null;
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

  // 2026-05-12: Magic-link confirm krok zrušen globálně (Petrovo rozhodnutí —
  // booking není veřejně dostupný, jen pro známé příjemce přes /calendar/invite
  // a interní /schuzka link). Rovnou vytváříme Google event a posíláme finální
  // potvrzovací mail s Meet linkem / místem. Status invite jde RESERVED → CONFIRMED
  // v jedné transakci uvnitř confirmReservation().
  //
  // Pro evergreen (/schuzka) vytvoř KLON — originál zůstává PENDING pro další leady.
  let created: typeof invite;
  if (isEvergreen) {
    created = await prisma.bookingInvite.create({
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
    created = await prisma.bookingInvite.update({
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

  // Rovnou potvrdit (žádný magic-link mail).
  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) throw new Error("Vlastník systému nebyl nalezen.");
  const confirmation = await confirmReservation(created.id, owner.id);

  return { inviteId: created.id, meetLink: confirmation.meetLink };
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

  // Potvrzovací mail příjemci. Neutrální tón, bez tykání/vykání a bez "děkuji" floskulí.
  if (invite.inviteeEmail) {
    const dateStr = startsAt.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
    const timeStr = `${fmtTime(startsAt)}–${fmtTime(endsAt)}`;
    const meetSection = result.meetLink
      ? `<p><strong>Google Meet:</strong> <a href="${result.meetLink}">${result.meetLink}</a></p>`
      : slot.type === "MEETING_PRAGUE"
        ? `<p><strong>Místo:</strong> Praha — adresa pošta samostatně.</p>`
        : slot.type === "MEETING_HOME"
          ? `<p><strong>Místo:</strong> u Petra doma — adresa pošta samostatně.</p>`
          : "";

    await sendMail({
      to: invite.inviteeEmail,
      subject: `Termín potvrzen — ${dateStr} ${timeStr}`,
      html: `
        <p>Termín <strong>${dateStr} ${timeStr}</strong> je potvrzen.</p>
        ${meetSection}
        <p>Pozvánka přijde samostatně z Google Kalendáře.</p>
        <p>Petr Peřina</p>
      `,
      text: `Termín ${dateStr} ${timeStr} je potvrzen.\n${result.meetLink ? `\nMeet: ${result.meetLink}\n` : ""}\nPetr Peřina`,
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

  // Cancel mail neutrálně.
  if (invite.inviteeEmail && (invite.status === "RESERVED" || invite.status === "CONFIRMED")) {
    await sendMail({
      to: invite.inviteeEmail,
      subject: "Termín zrušen",
      html: `
        <p>Termín byl zrušen.</p>
        <p>Pro nový termín odepište na tento e-mail.</p>
        <p>Petr Peřina</p>
      `,
      text: `Termín byl zrušen.\nPro nový termín odepište na tento e-mail.\n\nPetr Peřina`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}
