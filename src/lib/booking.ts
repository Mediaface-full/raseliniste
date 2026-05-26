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
  /**
   * Petr 2026-05-25: nejdřívější datum kdy host uvidí sloty. Pokud je v minulosti
   * nebo null, použije se jen globální lead time. Pokud v budoucnu, aplikuje
   * se MAX(now + leadTime, availableFrom).
   */
  availableFrom?: Date | null;
  /**
   * Petr 2026-05-25: veřejná poznámka — host ji uvidí v rezervačním pickeru,
   * v Google kalendářovém eventu (description) a v .ics popisu události.
   */
  publicNote?: string;
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
    const fullFromParts = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    contactSnapshot = {
      name: c.displayName?.trim() || fullFromParts || c.firstName || undefined,
      email: c.emails[0]?.email,
      phone: c.phones[0]?.number,
    };

    // Petr 2026-05-20: kontakt bez emailu = nemůžeme poslat booking
    // confirmation mail. Petr měl případ Martin Dlouhý: rezervace
    // proběhla, Google Calendar event vytvořen, ale mail tichu vynechán.
    // Lepší padnout tady s jasnou hláškou než tichu skipnout odeslání.
    if (!contactSnapshot.email) {
      throw new Error(
        `Kontakt "${contactSnapshot.name ?? "(bez jména)"}" nemá zadaný email. ` +
        `Doplň email v Kontaktech → /contacts/tabulka, jinak host nedostane ` +
        `potvrzovací mail. (Pro pozvánku bez emailu použij univerzální invite — ` +
        `contactId=null, host zadá email při rezervaci.)`,
      );
    }
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
      publicNote: input.publicNote?.trim() || null,
      status: "PENDING",
      // Snapshot vyplníme jen u univerzálního invite když ho použije cold lead
      // (vyplní se v reserveSlot). U personalizovaného známe od začátku.
      inviteeName: contactSnapshot.name,
      inviteeEmail: contactSnapshot.email,
      inviteePhone: contactSnapshot.phone,
      availableFrom: input.availableFrom ?? null,
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
    earliestSlotStart: invite.availableFrom ?? undefined,
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
    invite.publicNote ? invite.publicNote : "",
    invite.publicNote ? "" : "", // prázdný řádek za public note pokud byla
    invite.inviteeSubject ? `**Téma:** ${invite.inviteeSubject}` : "",
    invite.inviteeEmail ? `**E-mail:** ${invite.inviteeEmail}` : "",
    invite.inviteePhone ? `**Telefon:** ${invite.inviteePhone}` : "",
    invite.internalNote ? `**Poznámka (jen pro Petra):** ${invite.internalNote}` : "",
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

  // Petr 2026-05-25: persistuj meetLink + googleEventId, ať to má resend
  // i diagnose endpoint bez query do Google API.
  const updated = await prisma.bookingInvite.update({
    where: { id: invite.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      meetLink: result.meetLink,
      googleEventId: result.eventId,
    },
  });

  // Potvrzovací mail příjemci. Neutrální tón, bez tykání/vykání a bez "děkuji" floskulí.
  // Petr 2026-05-20: pokud invite NEMÁ email (legacy invite vytvořená před
  // validation fixem), zaloguj proč mail neodejde — ať nezmizí tichu.
  if (!invite.inviteeEmail) {
    console.warn(
      `[booking.reserve] invite ${invite.id} (${invite.inviteeName ?? "?"}) nemá email — ` +
      `potvrzovací mail PŘESKOČEN. Příčina: kontakt v DB nemá emails[0], nebo univerzální ` +
      `invite kde host email nezadal. Google Calendar event vytvořen, klient bez emailu.`,
    );
  }
  if (invite.inviteeEmail) {
    const mail = buildBookingConfirmMail({
      startsAt,
      endsAt,
      slotType: slot.type,
      meetLink: result.meetLink,
      inviteeName: invite.inviteeName,
      inviteeEmail: invite.inviteeEmail,
      inviteeSubject: invite.inviteeSubject,
      publicNote: invite.publicNote,
    });

    await sendMail({
      to: invite.inviteeEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      context: "booking-confirm",
      attachments: [
        {
          filename: "schuzka.ics",
          content: mail.ics,
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
          encoding: "utf-8",
        },
      ],
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
      context: "booking-cancel",
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Prague" });
}

/**
 * Petr 2026-05-25: jednotná stavba booking confirm mailu — sdílí
 * confirmReservation() a resend.ts endpoint. Vrací subject + html + text + .ics
 * attachment, takže host má vždy:
 *   - skutečný Meet link v těle (ne placeholder „viz Google invite")
 *   - kalendářový .ics soubor co si může přidat do libovolného kalendáře
 *     bez ohledu na to, jestli Google nativní invite (sendUpdates:all) dorazí
 *
 * Důvod: deliverability stížnosti květen 2026 (Jitka @lachevre.cz nedostala
 * potvrzení ani Meet link). Když selže jeden kanál, druhý ho vyrovná.
 */
export function buildBookingConfirmMail(params: {
  startsAt: Date;
  endsAt: Date;
  slotType: string;
  meetLink: string | null;
  inviteeName?: string | null;
  inviteeEmail: string;
  inviteeSubject?: string | null;
  publicNote?: string | null;
}): {
  subject: string;
  html: string;
  text: string;
  ics: string;
} {
  const { startsAt, endsAt, slotType, meetLink, inviteeName, inviteeEmail, inviteeSubject, publicNote } = params;

  const dateStr = startsAt.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  });
  const timeStr = `${fmtTime(startsAt)}–${fmtTime(endsAt)}`;

  const meetSection = meetLink
    ? `<p><strong>Google Meet:</strong> <a href="${meetLink}">${meetLink}</a></p>`
    : slotType === "MEETING_PRAGUE"
      ? `<p><strong>Místo:</strong> Praha — adresa pošta samostatně.</p>`
      : slotType === "MEETING_HOME"
        ? `<p><strong>Místo:</strong> u Petra doma — adresa pošta samostatně.</p>`
        : "";

  // Petr 2026-05-25: pokud je publicNote, ukáže se v mailu pod místem.
  const publicNoteHtml = publicNote
    ? `<div style="padding:12px;border-left:3px solid #b8763c;background:rgba(184,118,60,0.08);margin:12px 0;border-radius:4px;"><p style="margin:0;white-space:pre-wrap;">${escapeHtml(publicNote)}</p></div>`
    : "";
  const publicNoteText = publicNote ? `\n\n${publicNote}\n` : "";

  const html = `
    <p>Termín <strong>${dateStr} ${timeStr}</strong> je potvrzen.</p>
    ${meetSection}
    ${publicNoteHtml}
    <p>V příloze najdete kalendářový soubor (.ics) — můžete si jím přidat termín do libovolného kalendáře.</p>
    <p>Petr Peřina</p>
  `;

  const text = `Termín ${dateStr} ${timeStr} je potvrzen.\n${
    meetLink ? `\nMeet: ${meetLink}\n` : ""
  }${publicNoteText}\nV příloze je kalendářový .ics soubor.\n\nPetr Peřina`;

  return {
    subject: `Termín potvrzen — ${dateStr} ${timeStr}`,
    html,
    text,
    ics: buildIcs({ startsAt, endsAt, slotType, meetLink, inviteeName, inviteeEmail, inviteeSubject, publicNote }),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Postaví minimální validní VEVENT pro Apple/Google/Outlook/Mozilla Thunderbird.
 * Klíčové: UID stabilní (= booking invite id nebo deterministicky), DTSTART/DTEND
 * v UTC s `Z` suffixem (žádné TZID), LOCATION = meetLink pokud online (Apple
 * Mail tak ukáže Meet jako klikatelnou location).
 */
function buildIcs(params: {
  startsAt: Date;
  endsAt: Date;
  slotType: string;
  meetLink: string | null;
  inviteeName?: string | null;
  inviteeEmail: string;
  inviteeSubject?: string | null;
  publicNote?: string | null;
}): string {
  const { startsAt, endsAt, slotType, meetLink, inviteeName, inviteeEmail, inviteeSubject, publicNote } = params;
  const fmtIcs = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const uid = `booking-${startsAt.getTime()}-${inviteeEmail}@raseliniste.cz`;
  const summary = inviteeName
    ? `${slotType === "MEETING_ONLINE" ? "🎥" : "🤝"} Schůzka s Petrem Peřinou${inviteeSubject ? ` — ${inviteeSubject}` : ""}`
    : `Schůzka s Petrem Peřinou${inviteeSubject ? ` — ${inviteeSubject}` : ""}`;
  const location = slotType === "MEETING_ONLINE" && meetLink
    ? meetLink
    : slotType === "MEETING_PRAGUE"
      ? "Praha (adresa pošta samostatně)"
      : slotType === "MEETING_HOME"
        ? "U Petra doma (adresa pošta samostatně)"
        : "";
  // Petr 2026-05-25: publicNote do popisu eventu — host ji uvidí v kalendáři
  const descParts: string[] = [];
  if (publicNote) descParts.push(publicNote);
  if (meetLink) descParts.push(`Google Meet: ${meetLink}`);
  if (descParts.length === 0) descParts.push("Potvrzeno přes booking Rašeliniště.");
  const description = descParts.join("\n\n");

  // Escapování CR/LF a `;`,`,` per RFC 5545 — minimální, ale stačí pro běžné texty.
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Raseliniste//Booking//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmtIcs(new Date())}`,
    `DTSTART:${fmtIcs(startsAt)}`,
    `DTEND:${fmtIcs(endsAt)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    location ? `LOCATION:${esc(location)}` : "",
    `ORGANIZER;CN=Petr Peřina:mailto:oko@raseliniste.cz`,
    `ATTENDEE;CN=${esc(inviteeName ?? inviteeEmail)};RSVP=FALSE:mailto:${inviteeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}
