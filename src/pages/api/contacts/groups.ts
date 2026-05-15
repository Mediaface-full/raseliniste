/**
 * GET    /api/contacts/groups — list skupin s počty členů
 * POST   /api/contacts/groups — vytvoří novou skupinu (jen v DB, push na iCloud při sync)
 * DELETE /api/contacts/groups?name=X — smaže skupinu (odstraní z Contact.groups)
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.5, 7).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Skupiny z ContactGroup tabulky + počet členů spočítaný z Contact.groups
  const groups = await prisma.contactGroup.findMany({
    where: { userId: session.uid },
    orderBy: { name: "asc" },
  });
  const contacts = await prisma.contact.findMany({
    where: { userId: session.uid },
    select: { groups: true },
  });
  const counts = new Map<string, number>();
  for (const c of contacts) {
    for (const g of c.groups) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  // Sloučit s ContactGroup tabulkou (skupiny v DB ale bez členů ještě uvidíme)
  const allNames = new Set([...groups.map((g) => g.name), ...counts.keys()]);
  const result = Array.from(allNames).sort().map((name) => ({
    name,
    count: counts.get(name) ?? 0,
    icloudUid: groups.find((g) => g.name === name)?.icloudUid ?? null,
  }));
  return Response.json({ ok: true, groups: result });
};

const CreateBody = z.object({ name: z.string().min(1).max(100).trim() });

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Case-insensitive dedup: pokud existuje skupina se stejným jménem (case-ins),
  // vrátíme tu existující (brief 5.7).
  const existing = await prisma.contactGroup.findFirst({
    where: { userId: session.uid, name: { equals: body.name, mode: "insensitive" } },
  });
  if (existing) {
    return Response.json({ ok: true, group: existing, existed: true });
  }

  const created = await prisma.contactGroup.create({
    data: { userId: session.uid, name: body.name },
  });
  return Response.json({ ok: true, group: created });
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const name = url.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  // Smaž ContactGroup row + odstraň z Contact.groups pole u všech členů
  await prisma.contactGroup.deleteMany({ where: { userId: session.uid, name } });

  const members = await prisma.contact.findMany({
    where: { userId: session.uid, groups: { has: name } },
    select: { id: true, groups: true },
  });
  for (const m of members) {
    await prisma.contact.update({
      where: { id: m.id },
      data: { groups: m.groups.filter((g) => g !== name) },
    });
  }
  return Response.json({ ok: true, affectedContacts: members.length });
};
