import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

export const prerender = false;

const Body = z.object({
  email: z.string().trim().email().optional(),  // Petr může overridnout
});

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
}

/**
 * POST /api/booking/:id/resend  (Petr 2026-05-21)
 *
 * Znovu odeslání potvrzovacího mailu pro CONFIRMED pozvánku.
 * Použití: Petr měl Martina Dlouhého s rezervací CONFIRMED, ale kontakt
 * v Contacts neměl email → BookingInvite.inviteeEmail null → mail tichu
 * vynechán. Petr doplní email v Contacts (nebo ručně do body) a klikne
 * "Poslat znovu".
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
  if (!slotJson?.startsAt || !slotJson?.endsAt) {
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

  // Sestav mail (stejný formát jako v reserveSlot)
  const startsAt = new Date(slotJson.startsAt);
  const endsAt = new Date(slotJson.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return Response.json({ error: "reservedSlot.startsAt/endsAt není platný datum." }, { status: 400 });
  }
  const dateStr = startsAt.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Prague" });
  const timeStr = `${fmtTime(startsAt)}–${fmtTime(endsAt)}`;

  let locationLine = "";
  if (slotJson.type === "MEETING_ONLINE") {
    locationLine = `<p><em>Pokud máme Google Meet link, najdeš ho v kalendářové pozvánce z Google.</em></p>`;
  } else if (slotJson.type === "MEETING_PRAGUE") {
    locationLine = `<p><strong>Místo:</strong> Praha — adresa pošta samostatně.</p>`;
  } else if (slotJson.type === "MEETING_HOME") {
    locationLine = `<p><strong>Místo:</strong> u Petra doma — adresa pošta samostatně.</p>`;
  }

  const appUrl = env.APP_URL ?? "https://www.raseliniste.cz";
  const result = await sendMail({
    to: targetEmail,
    subject: `Termín potvrzen — ${dateStr} ${timeStr}`,
    html: `
      <p>Termín <strong>${dateStr} ${timeStr}</strong> je potvrzen.</p>
      ${locationLine}
      <p>Pozvánka přijde samostatně z Google Kalendáře.</p>
      <p>Petr Peřina · <a href="${appUrl}">${appUrl}</a></p>
    `,
    text: `Termín ${dateStr} ${timeStr} je potvrzen.\n\nPetr Peřina`,
    context: "booking-confirm-resend",
  });

  return Response.json({
    ok: result.ok,
    sentTo: targetEmail,
    provider: result.ok ? result.provider : null,
    providerId: result.ok ? result.id ?? null : null,
    error: result.ok ? null : result.error,
  });
};
