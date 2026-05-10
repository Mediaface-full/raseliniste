import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";
import { ensureCallLogToken } from "@/lib/call-log-token";

export const prerender = false;

const PhoneInput = z.object({
  number: z.string().min(3).max(30),
  label: z.string().max(30).optional().nullable(),
});

const EmailInput = z.object({
  email: z.string().email().max(200),
  label: z.string().max(30).optional().nullable(),
});

const CreateBody = z.object({
  displayName: z.string().min(1).max(200),
  firstName: z.string().max(100).optional().nullable(),
  firstNameVocative: z.string().max(100).optional().nullable(),
  greetingOverride: z.string().max(120).optional().nullable(),
  lastName: z.string().max(100).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  isVip: z.boolean().optional().default(false),
  isTeam: z.boolean().optional().default(false),
  clientTag: z.string().max(60).regex(/^[a-z0-9-]*$/).optional().nullable(),
  birthMonth: z.number().int().min(1).max(12).optional().nullable(),
  birthDay: z.number().int().min(1).max(31).optional().nullable(),
  birthdayReminderDaysBefore: z.number().int().min(0).max(60).optional().nullable(),
  birthdayReminderChannels: z.array(z.enum(["email", "whatsapp"])).optional(),
  phones: z.array(PhoneInput).default([]),
  emails: z.array(EmailInput).default([]),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const q = url.searchParams.get("q")?.trim() ?? "";
  const vipOnly = url.searchParams.get("vip") === "1";

  const contacts = await prisma.contact.findMany({
    where: {
      userId: session.uid,
      ...(vipOnly ? { isVip: true } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { phones: { some: { number: { contains: q } } } },
            ],
          }
        : {}),
    },
    include: {
      phones: true,
      emails: true,
      _count: { select: { callLogs: true } },
    },
    orderBy: [{ isVip: "desc" }, { displayName: "asc" }],
    take: 500,
  });

  return Response.json({ contacts });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch (e) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Normalize phones
  const normalizedPhones: { number: string; label: string | null }[] = [];
  for (const p of body.phones) {
    const n = normalizePhone(p.number);
    if (n) normalizedPhones.push({ number: n, label: p.label ?? null });
  }

  const contact = await prisma.contact.create({
    data: {
      userId: session.uid,
      displayName: body.displayName,
      firstName: body.firstName ?? null,
      firstNameVocative: body.firstNameVocative ?? null,
      greetingOverride: body.greetingOverride ?? null,
      lastName: body.lastName ?? null,
      note: body.note ?? null,
      isVip: body.isVip,
      isTeam: body.isTeam,
      clientTag: body.clientTag || null,
      birthMonth: body.birthMonth ?? null,
      birthDay: body.birthDay ?? null,
      birthdayReminderDaysBefore: body.birthdayReminderDaysBefore ?? null,
      birthdayReminderChannels: body.birthdayReminderChannels ?? [],
      importedFrom: "manual",
      phones: { create: normalizedPhones },
      emails: {
        create: body.emails.map((e) => ({ email: e.email, label: e.label ?? null })),
      },
    },
    include: { phones: true, emails: true },
  });

  if (contact.isVip) {
    await ensureCallLogToken(contact.id).catch((e) => console.warn("[contacts.create] token:", e));
  }
  const fresh = await prisma.contact.findUnique({
    where: { id: contact.id },
    include: { phones: true, emails: true },
  });
  return Response.json({ contact: fresh ?? contact });
};
