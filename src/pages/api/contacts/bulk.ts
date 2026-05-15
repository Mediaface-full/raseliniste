/**
 * POST /api/contacts/bulk
 *
 * Hromadné akce nad podmnožinou kontaktů.
 * Body: { ids: string[], action: "delete" | "add-group" | "remove-group", groupName?: string }
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.6).
 *
 * Bezpečnost: před delete vyrobí ContactBackup row per kontakt.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { backupContact } from "@/lib/contacts-backup";

export const prerender = false;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids: z.array(z.string()).min(1).max(500) }),
  z.object({ action: z.literal("add-group"), ids: z.array(z.string()).min(1).max(500), groupName: z.string().min(1).max(100) }),
  z.object({ action: z.literal("remove-group"), ids: z.array(z.string()).min(1).max(500), groupName: z.string().min(1).max(100) }),
]);

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Bezpečnost: jen vlastní kontakty
  const contacts = await prisma.contact.findMany({
    where: { id: { in: body.ids }, userId: session.uid },
    select: { id: true, groups: true, displayName: true },
  });
  if (contacts.length === 0) return Response.json({ ok: true, processed: 0 });

  if (body.action === "delete") {
    // Auto-backup před delete
    for (const c of contacts) {
      await backupContact(session.uid, c.id, "before_delete").catch(() => null);
    }
    await prisma.contact.deleteMany({
      where: { id: { in: contacts.map((c) => c.id) }, userId: session.uid },
    });
    return Response.json({ ok: true, processed: contacts.length, action: "delete" });
  }

  if (body.action === "add-group") {
    let updated = 0;
    for (const c of contacts) {
      if (c.groups.includes(body.groupName)) continue;
      await prisma.contact.update({
        where: { id: c.id },
        data: { groups: [...c.groups, body.groupName].sort() },
      });
      updated++;
    }
    return Response.json({ ok: true, processed: updated, action: "add-group" });
  }

  if (body.action === "remove-group") {
    let updated = 0;
    for (const c of contacts) {
      if (!c.groups.includes(body.groupName)) continue;
      await prisma.contact.update({
        where: { id: c.id },
        data: { groups: c.groups.filter((g) => g !== body.groupName) },
      });
      updated++;
    }
    return Response.json({ ok: true, processed: updated, action: "remove-group" });
  }

  return Response.json({ error: "unreachable" }, { status: 500 });
};
