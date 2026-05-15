/**
 * GET /api/contacts/tabulka — list kontaktů pro tabulkovou editaci
 *   query: ?page=1&pageSize=25&q=hledany_text&validation=missing-phone
 * PATCH /api/contacts/tabulka — bulk save dirty řádků
 *   body: { changes: Array<{ id, field, value }> }
 *
 * Petr 2026-05-14/15 (kontakty_brief.md F1.5).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get("pageSize") ?? "25", 10)));
  const q = (url.searchParams.get("q") ?? "").trim();
  const validation = url.searchParams.get("validation") ?? "";

  // Filter
  const where: Record<string, unknown> = { userId: session.uid };
  if (q) {
    Object.assign(where, {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { phones: { some: { number: { contains: q } } } },
        { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
        { note: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  // Validační filtry (kontakty_brief.md 5.8 sekce A)
  if (validation === "no-phone") Object.assign(where, { phones: { none: {} } });
  if (validation === "no-email") Object.assign(where, { emails: { none: {} } });
  if (validation === "no-group") Object.assign(where, { groups: { equals: [] } });
  if (validation === "no-company") Object.assign(where, { company: null });
  if (validation === "no-contact") Object.assign(where, { phones: { none: {} }, emails: { none: {} } });
  if (validation === "incomplete-name") {
    Object.assign(where, {
      OR: [
        { firstName: null, lastName: null },
        { displayName: "" },
      ],
    });
  }

  const [contacts, total, groupsRaw] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { phones: true, emails: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { displayName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contact.count({ where }),
    prisma.contactGroup.findMany({
      where: { userId: session.uid },
      select: { name: true, memberUids: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Group chips: jméno + počet členů
  const groupChips = groupsRaw.map((g) => ({ name: g.name, count: g.memberUids.length }));

  return Response.json({
    contacts: contacts.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      note: c.note,
      groups: c.groups,
      addressLines: c.addressLines,
      birthYear: c.birthYear,
      birthMonth: c.birthMonth,
      birthDay: c.birthDay,
      isVip: c.isVip,
      isTeam: c.isTeam,
      clientTag: c.clientTag,
      syncSource: c.syncSource,
      icloudUid: c.icloudUid,
      lastIcloudSyncAt: c.lastIcloudSyncAt?.toISOString() ?? null,
      phones: c.phones.map((p) => ({ id: p.id, number: p.number, label: p.label })),
      emails: c.emails.map((e) => ({ id: e.id, email: e.email, label: e.label })),
    })),
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
    groups: groupChips,
  });
};

// ============================================================================
// PATCH — bulk save dirty rows
// ============================================================================

const Change = z.object({
  id: z.string().min(1),
  field: z.enum([
    "displayName", "firstName", "lastName", "company", "note",
    "birthYear", "birthMonth", "birthDay",
    "phone1", "phone2", "phone3",       // 3 sloty
    "email1", "email2",                  // 2 sloty
    "address", "groups",
  ]),
  value: z.union([z.string(), z.number(), z.null(), z.array(z.string())]),
});

const PatchBody = z.object({
  changes: z.array(Change).min(1).max(500),
});

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Group changes po contactId — víc změn na jednom kontaktu = jeden update
  const byContactId = new Map<string, typeof body.changes>();
  for (const c of body.changes) {
    const arr = byContactId.get(c.id) ?? [];
    arr.push(c);
    byContactId.set(c.id, arr);
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const [contactId, changes] of byContactId.entries()) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, userId: session.uid },
        include: { phones: true, emails: true },
      });
      if (!contact) {
        results.push({ id: contactId, ok: false, error: "NOT_FOUND" });
        continue;
      }

      const updateData: Record<string, unknown> = {};
      const phoneOps: Array<{ slot: number; value: string }> = [];
      const emailOps: Array<{ slot: number; value: string }> = [];

      for (const c of changes) {
        switch (c.field) {
          case "displayName":
          case "firstName":
          case "lastName":
          case "company":
          case "note":
            updateData[c.field] = typeof c.value === "string" ? (c.value.trim() || null) : null;
            break;
          case "birthYear":
          case "birthMonth":
          case "birthDay":
            updateData[c.field] = typeof c.value === "number" ? c.value : null;
            break;
          case "address":
            updateData.addressLines = typeof c.value === "string" && c.value.trim()
              ? [c.value.trim()]
              : [];
            break;
          case "groups":
            updateData.groups = Array.isArray(c.value)
              ? Array.from(new Set(c.value.map((s) => String(s).trim()).filter(Boolean))).sort()
              : [];
            break;
          case "phone1":
          case "phone2":
          case "phone3":
            phoneOps.push({ slot: parseInt(c.field.slice(5), 10) - 1, value: String(c.value ?? "") });
            break;
          case "email1":
          case "email2":
            emailOps.push({ slot: parseInt(c.field.slice(5), 10) - 1, value: String(c.value ?? "") });
            break;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.contact.update({ where: { id: contactId }, data: updateData });
      }

      // Phone slots: pokud má hodnotu, upsert; pokud prázdná, delete na pozici
      if (phoneOps.length > 0) {
        for (const op of phoneOps) {
          const existing = contact.phones[op.slot];
          if (op.value.trim()) {
            const normalized = normalizePhone(op.value) ?? op.value.trim();
            if (existing) {
              await prisma.phone.update({ where: { id: existing.id }, data: { number: normalized } });
            } else {
              await prisma.phone.create({ data: { contactId, number: normalized, label: op.slot === 0 ? "mobile" : "work" } });
            }
          } else if (existing) {
            await prisma.phone.delete({ where: { id: existing.id } });
          }
        }
      }

      if (emailOps.length > 0) {
        for (const op of emailOps) {
          const existing = contact.emails[op.slot];
          if (op.value.trim()) {
            const normalized = op.value.trim().toLowerCase();
            if (existing) {
              await prisma.contactEmail.update({ where: { id: existing.id }, data: { email: normalized } });
            } else {
              await prisma.contactEmail.create({ data: { contactId, email: normalized, label: op.slot === 0 ? "work" : "home" } });
            }
          } else if (existing) {
            await prisma.contactEmail.delete({ where: { id: existing.id } });
          }
        }
      }

      results.push({ id: contactId, ok: true });
    } catch (e) {
      results.push({ id: contactId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ ok: true, results });
};
