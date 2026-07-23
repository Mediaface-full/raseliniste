import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { buildKolegyneDigest } from "@/lib/planning-digest";

export const prerender = false;

const Body = z.object({
  enabled: z.boolean(),
  contactId: z.string().nullable(),
});

/** GET /api/planovani/digest — nastavení + náhled aktuálního digestu */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const settings = await prisma.planningSettings.findUnique({
    where: { userId: session.uid },
    include: { digestContact: { select: { id: true, displayName: true } } },
  });

  if (url.searchParams.get("nahled") === "1") {
    const contactId = settings?.digestContactId;
    if (!contactId) return Response.json({ error: "Nejdřív vyber kolegyni." }, { status: 400 });
    const digest = await buildKolegyneDigest(session.uid, contactId);
    return Response.json({ ok: true, ...digest });
  }

  const teamContacts = await prisma.contact.findMany({
    where: { userId: session.uid, isTeam: true },
    select: { id: true, displayName: true, emails: { select: { email: true }, take: 1 } },
    orderBy: { displayName: "asc" },
  });

  return Response.json({
    enabled: settings?.digestEnabled ?? false,
    contactId: settings?.digestContactId ?? null,
    teamContacts: teamContacts.map((c) => ({ id: c.id, name: c.displayName, email: c.emails[0]?.email ?? null })),
  });
};

/** PUT /api/planovani/digest — uloží nastavení digestu */
export const PUT: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  if (parsed.data.contactId) {
    const c = await prisma.contact.findFirst({ where: { id: parsed.data.contactId, userId: session.uid } });
    if (!c) return Response.json({ error: "Kontakt nenalezen." }, { status: 404 });
  }

  await prisma.planningSettings.upsert({
    where: { userId: session.uid },
    create: { userId: session.uid, digestEnabled: parsed.data.enabled, digestContactId: parsed.data.contactId },
    update: { digestEnabled: parsed.data.enabled, digestContactId: parsed.data.contactId },
  });
  return Response.json({ ok: true });
};
