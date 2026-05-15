/**
 * POST /api/contacts/cleanup-entities
 *
 * Petr 2026-05-15: po prvním iCloud sync jsou v DB `&#13;` (HTML entity
 * pro \r) v Contact.firstName/lastName/displayName/company/note,
 * Phone.number, ContactEmail.email, ContactGroup.name. Příčina v
 * carddav.ts decodeXmlEntities — nepodporovala numeric entities. Fix
 * commitnutý, ale historická data potřebují vyčistit.
 *
 * Tento endpoint projede VŠECHNY Contact rows + Phone + ContactEmail +
 * ContactGroup a odstraní HTML entities + trim. Idempotentní.
 *
 * Plus odstraní duplicitní řádky vzniklé sync (oba se stejným jménem,
 * jeden s `&#13;` v poli, druhý čistý) — necháme čistý, smažeme entitní
 * verzi.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const ENTITY_RE = /&#(\d+);|&#x([0-9a-f]+);|&amp;|&lt;|&gt;|&quot;|&apos;/gi;

function hasEntities(s: string | null | undefined): boolean {
  if (!s) return false;
  return ENTITY_RE.test(s);
}

function decodeEntities(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\r/g, "") // odstranit CR (\r) z koncovek hodnot — Apple je posílá zbytečně
    .trim();
}

/**
 * Speciální handler pro adresy — adresa může mít `\n` uvnitř (oddělovač mezi
 * ulice/město/země). Trim aplikujeme jen na začátek/konec celé hodnoty, ne
 * mezi řádky. Plus odstraníme `\r` na konci jednotlivých řádků a prázdné řádky.
 */
function decodeAddress(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const decoded = s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  // Strip `\r` per řádek + odstranit prázdné řádky + finální trim
  return decoded
    .split(/\n/)
    .map((line) => line.replace(/\r/g, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const stats = {
    contactsUpdated: 0,
    phonesUpdated: 0,
    emailsUpdated: 0,
    groupsUpdated: 0,
    duplicatesDeleted: 0,
    emptyContactsDeleted: 0,
  };

  // 1) Contact rows — projet všechny fields
  const contacts = await prisma.contact.findMany({
    where: { userId: session.uid },
    include: { phones: true, emails: true },
  });

  for (const c of contacts) {
    const updates: Record<string, unknown> = {};
    const display = decodeEntities(c.displayName);
    if (display !== c.displayName) updates.displayName = display;
    const fn = decodeEntities(c.firstName);
    if (fn !== c.firstName) updates.firstName = fn;
    const ln = decodeEntities(c.lastName);
    if (ln !== c.lastName) updates.lastName = ln;
    const co = decodeEntities(c.company);
    if (co !== c.company) updates.company = co;
    const note = decodeEntities(c.note);
    if (note !== c.note) updates.note = note;
    const fv = decodeEntities(c.firstNameVocative);
    if (fv !== c.firstNameVocative) updates.firstNameVocative = fv;
    const greet = decodeEntities(c.greetingOverride);
    if (greet !== c.greetingOverride) updates.greetingOverride = greet;

    // Pole adres — speciální handler decodeAddress (zachová `\n` uvnitř, jen
    // strip `\r` a entity)
    const cleanedAddr = c.addressLines.map((line) => decodeAddress(line) ?? "").filter(Boolean);
    if (JSON.stringify(cleanedAddr) !== JSON.stringify(c.addressLines)) {
      updates.addressLines = cleanedAddr;
    }
    const cleanedGroups = c.groups.map((g) => decodeEntities(g) ?? "").filter(Boolean);
    if (JSON.stringify(cleanedGroups) !== JSON.stringify(c.groups)) {
      updates.groups = cleanedGroups;
    }
    const cleanedAliases = c.aliases.map((a) => decodeEntities(a) ?? "").filter(Boolean);
    if (JSON.stringify(cleanedAliases) !== JSON.stringify(c.aliases)) {
      updates.aliases = cleanedAliases;
    }
    const cleanedClientAliases = c.clientTagAliases.map((a) => decodeEntities(a) ?? "").filter(Boolean);
    if (JSON.stringify(cleanedClientAliases) !== JSON.stringify(c.clientTagAliases)) {
      updates.clientTagAliases = cleanedClientAliases;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contact.update({ where: { id: c.id }, data: updates });
      stats.contactsUpdated++;
    }
  }

  // 2) Phone
  const phones = await prisma.phone.findMany({
    where: { contact: { userId: session.uid } },
  });
  for (const p of phones) {
    const updates: Record<string, unknown> = {};
    const num = decodeEntities(p.number);
    if (num !== p.number) updates.number = num;
    const lbl = decodeEntities(p.label);
    if (lbl !== p.label) updates.label = lbl;
    if (Object.keys(updates).length > 0) {
      await prisma.phone.update({ where: { id: p.id }, data: updates }).catch(() => null);
      stats.phonesUpdated++;
    }
  }

  // 3) ContactEmail
  const emails = await prisma.contactEmail.findMany({
    where: { contact: { userId: session.uid } },
  });
  for (const e of emails) {
    const updates: Record<string, unknown> = {};
    const em = decodeEntities(e.email);
    if (em !== e.email) updates.email = em;
    const lbl = decodeEntities(e.label);
    if (lbl !== e.label) updates.label = lbl;
    if (Object.keys(updates).length > 0) {
      await prisma.contactEmail.update({ where: { id: e.id }, data: updates }).catch(() => null);
      stats.emailsUpdated++;
    }
  }

  // 4) ContactGroup
  const groups = await prisma.contactGroup.findMany({
    where: { userId: session.uid },
  });
  for (const g of groups) {
    const updates: Record<string, unknown> = {};
    const name = decodeEntities(g.name);
    if (name !== g.name) updates.name = name;
    if (Object.keys(updates).length > 0) {
      await prisma.contactGroup.update({ where: { id: g.id }, data: updates }).catch(() => null);
      stats.groupsUpdated++;
    }
  }

  // 5) Po cleanup zkontrolovat duplicity podle Phone.number — Petr 2026-05-15
  // všechny duplicity v jeho tabulce měly chybu v emailu/telefonu (originál
  // čistý, duplikát s `&#13;`). Po decode jsou identické → smazat
  // mladší/duplicate Phone records.
  // POZOR: jen Phone dedup. Contact rows ponecháme — F2 Duplicity merge UI
  // sloučí kontakty správně se zachováním overlay polí.
  const phonesAfter = await prisma.phone.findMany({
    where: { contact: { userId: session.uid } },
    orderBy: { id: "asc" },
  });
  const seen = new Map<string, string>(); // contactId:number → first Phone.id
  const toDeletePhone: string[] = [];
  for (const p of phonesAfter) {
    const key = `${p.contactId}:${p.number}`;
    if (seen.has(key)) {
      toDeletePhone.push(p.id);
    } else {
      seen.set(key, p.id);
    }
  }
  if (toDeletePhone.length > 0) {
    await prisma.phone.deleteMany({ where: { id: { in: toDeletePhone } } });
  }

  const emailsAfter = await prisma.contactEmail.findMany({
    where: { contact: { userId: session.uid } },
    orderBy: { id: "asc" },
  });
  const seenEmail = new Map<string, string>();
  const toDeleteEmail: string[] = [];
  for (const e of emailsAfter) {
    const key = `${e.contactId}:${e.email.toLowerCase()}`;
    if (seenEmail.has(key)) {
      toDeleteEmail.push(e.id);
    } else {
      seenEmail.set(key, e.id);
    }
  }
  if (toDeleteEmail.length > 0) {
    await prisma.contactEmail.deleteMany({ where: { id: { in: toDeleteEmail } } });
  }
  stats.duplicatesDeleted = toDeletePhone.length + toDeleteEmail.length;

  // 6) Smazat PRÁZDNÉ kontakty (stub z iCloudu — žádné jméno, žádný tel,
  //    žádný email, žádná firma — Apple bug s nedokončenými importy).
  //    Detekce po cleanup entit, kdy zbude "" / "\r" / whitespace.
  const allContacts = await prisma.contact.findMany({
    where: { userId: session.uid },
    include: { phones: true, emails: true },
  });
  const emptyIds: string[] = [];
  for (const c of allContacts) {
    const nameClean = (c.displayName ?? "").replace(/[\r\n\s&#0-9;]+/g, "").trim();
    const firstClean = (c.firstName ?? "").replace(/[\r\n\s&#0-9;]+/g, "").trim();
    const lastClean = (c.lastName ?? "").replace(/[\r\n\s&#0-9;]+/g, "").trim();
    const orgClean = (c.company ?? "").replace(/[\r\n\s&#0-9;]+/g, "").trim();
    const hasReadableName =
      // alespoň jedno písmeno (ne jen čísla a entity)
      /[a-zA-ZÀ-ž]/.test(nameClean) || /[a-zA-ZÀ-ž]/.test(firstClean) || /[a-zA-ZÀ-ž]/.test(lastClean);
    const hasContact = c.phones.length > 0 || c.emails.length > 0;
    const hasOrg = /[a-zA-ZÀ-ž]/.test(orgClean);
    // POZOR: nesmazat overlay kontakty (isVip/clientTag/aliases) — i kdyby
    // byly "prázdné" po decode, Petr je vědomě udržuje (VIP token, alias).
    const hasOverlay = c.isVip || c.isTeam || c.clientTag !== null || c.aliases.length > 0 || c.callLogToken !== null;
    if (!hasReadableName && !hasContact && !hasOrg && !hasOverlay) {
      emptyIds.push(c.id);
    }
  }
  if (emptyIds.length > 0) {
    await prisma.contact.deleteMany({ where: { id: { in: emptyIds } } });
    stats.emptyContactsDeleted = emptyIds.length;
  }

  return Response.json({ ok: true, stats });
};
