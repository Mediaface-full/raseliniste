import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

export const prerender = false;

/**
 * Odeslání pozvánkového linku hostovi (Gideon 2026-08-27).
 *
 * GET  → připravené návrhy zpráv (email subject+body, SMS text) — Gideon je
 *        v UI VIDÍ a může upravit před odesláním („chci ten mail vidět").
 * POST → { channel: "email", subject, body } odešle mail s linkem,
 *        { channel: "sms", message } odešle SMS přes GoSMS.
 *
 * Jen pro pozvánky, kde si host teprve vybírá termín (PENDING/VIEWED).
 */

const APP_URL = () => env.APP_URL || "https://www.raseliniste.cz";

async function loadInvite(id: string) {
  return prisma.bookingInvite.findUnique({
    where: { id },
    include: { contact: { select: { displayName: true, firstName: true, phones: { select: { number: true }, take: 1 } } } },
  });
}

function defaultDrafts(invite: NonNullable<Awaited<ReturnType<typeof loadInvite>>>) {
  const url = `${APP_URL()}/i/${invite.token}`;
  const name = invite.inviteeName ?? invite.contact?.displayName ?? "";
  const validUntil = invite.validUntil.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
  const subject = "Pozvánka — výběr termínu schůzky";
  const body = [
    name ? `Dobrý den,` : `Dobrý den,`,
    "",
    `posílám odkaz pro výběr termínu naší schůzky:`,
    url,
    "",
    `Stačí kliknout a vybrat čas, který Vám vyhovuje — potvrzení přijde obratem e-mailem.`,
    `Odkaz platí do ${validUntil}.`,
    "",
    `Gideon Peřina`,
  ].join("\n");
  const sms = `Dobrý den, posílám odkaz pro výběr termínu schůzky: ${url} — stačí kliknout a vybrat čas. Gideon Peřina`;
  return { url, subject, body, sms };
}

export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const invite = await loadInvite(params.id!);
  if (!invite) return Response.json({ error: "Pozvánka nenalezena." }, { status: 404 });

  const drafts = defaultDrafts(invite);
  return Response.json({
    ok: true,
    email: { to: invite.inviteeEmail, subject: drafts.subject, body: drafts.body },
    sms: { to: invite.inviteePhone ?? invite.contact?.phones?.[0]?.number ?? null, message: drafts.sms },
    url: drafts.url,
  });
};

const Body = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }),
  z.object({ channel: z.literal("sms"), message: z.string().min(1).max(600), to: z.string().min(6).max(30).optional() }),
]);

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const invite = await loadInvite(params.id!);
  if (!invite) return Response.json({ error: "Pozvánka nenalezena." }, { status: 404 });
  if (invite.status !== "PENDING" && invite.status !== "VIEWED") {
    return Response.json({ error: `Pozvánka je ve stavu ${invite.status} — host už termín řešil. Pro znovuposlání potvrzení použij „Poslat mail".` }, { status: 400 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const b = parsed.data;

  if (b.channel === "email") {
    if (!invite.inviteeEmail) return Response.json({ error: "Pozvánka nemá e-mail — doplň ho ke kontaktu." }, { status: 400 });
    const htmlBody = b.body
      .split("\n")
      .map((line) => {
        const esc = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const linked = esc.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
        return linked.trim() === "" ? "<br>" : `<p style="margin:0 0 4px 0;">${linked}</p>`;
      })
      .join("\n");
    await sendMail({
      to: invite.inviteeEmail,
      subject: b.subject,
      html: htmlBody,
      text: b.body,
      context: "booking-invite-link",
    });
    console.log(`[booking.send-invite] email → ${invite.inviteeEmail} (invite ${invite.id})`);
    return Response.json({ ok: true, channel: "email", to: invite.inviteeEmail });
  }

  // SMS přes GoSMS
  const to = b.to?.trim() || invite.inviteePhone || invite.contact?.phones?.[0]?.number;
  if (!to) return Response.json({ error: "Kontakt nemá telefonní číslo — SMS nejde poslat." }, { status: 400 });
  const { sendUserSms } = await import("@/lib/sms-send");
  const result = await sendUserSms(session.uid, {
    to,
    message: b.message,
    linkedEntity: { type: "booking", id: invite.id, label: `Pozvánka ${invite.inviteeName ?? ""}`.trim() },
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 });
  console.log(`[booking.send-invite] sms → ${to} (invite ${invite.id})`);
  return Response.json({ ok: true, channel: "sms", to });
};
