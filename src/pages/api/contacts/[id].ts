import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";
import { ensureCallLogToken } from "@/lib/call-log-token";

export const prerender = false;

const PatchBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  firstName: z.string().max(100).nullable().optional(),
  firstNameVocative: z.string().max(100).nullable().optional(),
  greetingOverride: z.string().max(120).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  isVip: z.boolean().optional(),
  isTeam: z.boolean().optional(),
  // Slug klienta — povolen jen lowercase, číslice, pomlčka. Server-side
  // poslední bezpečnost před AI-generated slugy.
  clientTag: z.string().max(60).regex(/^[a-z0-9-]*$/, "Slug může obsahovat jen malá písmena, číslice a pomlčky").nullable().optional(),
  // Aliases pro AI extract — synonyma jak Petr v audiu kontakt/klienta
  // nazývá (např. "TK", "Tékáčko", "Karel z TK"). Každý alias je trimmed
  // + lowercase při uložení. Routing pracuje s kanonizovanou hodnotou,
  // ne s aliases.
  aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
  clientTagAliases: z.array(z.string().min(1).max(80)).max(20).optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthdayReminderDaysBefore: z.number().int().min(0).max(60).nullable().optional(),
  birthdayReminderChannels: z.array(z.enum(["email", "whatsapp"])).optional(),
  phones: z
    .array(z.object({ number: z.string(), label: z.string().nullable().optional() }))
    .optional(),
  emails: z
    .array(z.object({ email: z.string().email(), label: z.string().nullable().optional() }))
    .optional(),
});

async function ownContact(userId: string, id: string) {
  const c = await prisma.contact.findFirst({ where: { id, userId } });
  return c;
}

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await ownContact(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Pokud se posílají phones/emails, nahraď je celé (jednodušší než diff)
  if (body.phones) {
    await prisma.phone.deleteMany({ where: { contactId: id } });
    const normalized = body.phones
      .map((p) => {
        const n = normalizePhone(p.number);
        return n ? { contactId: id, number: n, label: p.label ?? null } : null;
      })
      .filter((x): x is { contactId: string; number: string; label: string | null } => x !== null);
    if (normalized.length > 0) {
      await prisma.phone.createMany({ data: normalized, skipDuplicates: true });
    }
  }

  if (body.emails) {
    await prisma.contactEmail.deleteMany({ where: { contactId: id } });
    if (body.emails.length > 0) {
      await prisma.contactEmail.createMany({
        data: body.emails.map((e) => ({ contactId: id, email: e.email, label: e.label ?? null })),
        skipDuplicates: true,
      });
    }
  }

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.firstNameVocative !== undefined ? { firstNameVocative: body.firstNameVocative } : {}),
      ...(body.greetingOverride !== undefined ? { greetingOverride: body.greetingOverride } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.isVip !== undefined ? { isVip: body.isVip } : {}),
      ...(body.isTeam !== undefined ? { isTeam: body.isTeam } : {}),
      ...(body.clientTag !== undefined ? { clientTag: body.clientTag || null } : {}),
      // Aliases — trim + lowercase + dedup
      ...(body.aliases !== undefined ? {
        aliases: Array.from(new Set(body.aliases.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0))),
      } : {}),
      ...(body.clientTagAliases !== undefined ? {
        clientTagAliases: Array.from(new Set(body.clientTagAliases.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0))),
      } : {}),
      ...(body.birthMonth !== undefined ? { birthMonth: body.birthMonth } : {}),
      ...(body.birthDay !== undefined ? { birthDay: body.birthDay } : {}),
      ...(body.birthdayReminderDaysBefore !== undefined ? { birthdayReminderDaysBefore: body.birthdayReminderDaysBefore } : {}),
      ...(body.birthdayReminderChannels !== undefined ? { birthdayReminderChannels: body.birthdayReminderChannels } : {}),
    },
    include: { phones: true, emails: true },
  });

  // Pokud byl nově označen jako VIP a nemá token, vygeneruj.
  if (contact.isVip && !contact.callLogToken) {
    await ensureCallLogToken(contact.id).catch((e) => {
      console.warn("[contacts] ensureCallLogToken failed:", e);
    });
  }

  // Re-fetch aby v response byl token (i pokud byl právě vygenerovaný)
  const fresh = await prisma.contact.findUnique({
    where: { id },
    include: { phones: true, emails: true },
  });
  return Response.json({ contact: fresh });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await ownContact(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Petr 2026-05-15 (kontakty_brief.md 5.8 F): auto-backup před delete.
  const { backupContact } = await import("@/lib/contacts-backup");
  await backupContact(session.uid, id, "before_delete").catch(() => null);

  await prisma.contact.delete({ where: { id } });
  return Response.json({ ok: true });
};
