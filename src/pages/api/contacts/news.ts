/**
 * GET  /api/contacts/news — vrátí kontakty přidané od baseline (banner)
 * POST /api/contacts/news/mark-seen — update baseline na teď
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.4): banner „Nově přidané z mobilu".
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { contactsSeenBaselineAt: true },
  });

  const baseline = user?.contactsSeenBaselineAt;
  // Pokud baseline neexistuje, NIC neukazujeme jako "nové" — uživatel
  // poprvé používá feature. Set baseline na teď a vrátíme prázdný diff.
  if (!baseline) {
    await prisma.user.update({
      where: { id: session.uid },
      data: { contactsSeenBaselineAt: new Date() },
    });
    return Response.json({ ok: true, newContactIds: [], baseline: new Date().toISOString() });
  }

  // Nové kontakty od baseline — typicky importované přes iCloud sync z mobilu.
  // Filter: created > baseline AND syncSource = icloud (= přišly z iCloud sync,
  // ne z manuálního create v UI).
  const newContacts = await prisma.contact.findMany({
    where: {
      userId: session.uid,
      createdAt: { gt: baseline },
      syncSource: "icloud",
    },
    select: { id: true, displayName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    ok: true,
    newContactIds: newContacts.map((c) => c.id),
    newContacts: newContacts.map((c) => ({ id: c.id, displayName: c.displayName, createdAt: c.createdAt.toISOString() })),
    baseline: baseline.toISOString(),
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await prisma.user.update({
    where: { id: session.uid },
    data: { contactsSeenBaselineAt: new Date() },
  });
  return Response.json({ ok: true, baseline: new Date().toISOString() });
};
