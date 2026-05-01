import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";

export const prerender = false;

const PatchBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  firstName: z.string().max(100).nullable().optional(),
  firstNameVocative: z.string().max(100).nullable().optional(),
  greetingOverride: z.string().max(120).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  isVip: z.boolean().optional(),
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
      ...(body.birthMonth !== undefined ? { birthMonth: body.birthMonth } : {}),
      ...(body.birthDay !== undefined ? { birthDay: body.birthDay } : {}),
      ...(body.birthdayReminderDaysBefore !== undefined ? { birthdayReminderDaysBefore: body.birthdayReminderDaysBefore } : {}),
      ...(body.birthdayReminderChannels !== undefined ? { birthdayReminderChannels: body.birthdayReminderChannels } : {}),
    },
    include: { phones: true, emails: true },
  });

  return Response.json({ contact });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await ownContact(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.contact.delete({ where: { id } });
  return Response.json({ ok: true });
};
