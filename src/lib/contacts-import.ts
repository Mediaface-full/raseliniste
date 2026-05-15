/**
 * Import kontaktů z VCF / CSV (kontakty_brief.md 5.8 E).
 *
 * Parser:
 *   - VCF — používá existující parseVCardFile (legacy) a parseVCardFull
 *     (nový, bohatší). Detekce přes BEGIN:VCARD header.
 *   - CSV — sniffer pro středník / čárku, mapování českých + anglických
 *     hlaviček.
 *
 * Collision detection:
 *   - Match podle phone (posledních 9 číslic) nebo email
 *   - Default skip duplicit, volitelně overwrite
 */

import { prisma } from "./db";
import { parseVCardFile, parseVCardFull, type VCardContact } from "./vcard";
import { normalizePhone } from "./phone";

export interface ImportPreview {
  totalParsed: number;
  newContacts: number;
  collisions: number;
  collisionsList: Array<{
    importedName: string;
    matchedId: string;
    matchedName: string;
    matchReason: string;
  }>;
}

export interface ImportApplyResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

// ============================================================================
// VCF Import
// ============================================================================

export async function importVcf(
  userId: string,
  fileContent: string,
  options: { overwrite: boolean; action: "preview" | "apply" },
): Promise<ImportPreview & Partial<ImportApplyResult>> {
  // Parse vCard 3.0 — projít všechny BEGIN:VCARD bloky
  // Pro bohatší pole použij parseVCardFull, ale ten bere jen 1 vCard.
  // Strategie: rozdělit obsah na bloky, každý parsovat zvlášť.
  const blocks = fileContent.split(/(?=BEGIN:VCARD)/i).filter((b) => /BEGIN:VCARD/i.test(b));
  const parsed: VCardContact[] = [];
  for (const block of blocks) {
    const c = parseVCardFull(block);
    if (c) parsed.push(c);
  }
  return doImport(userId, parsed, options);
}

// ============================================================================
// CSV Import
// ============================================================================

const CSV_HEADERS = {
  // czech : english : VCardContact field
  firstName: ["jméno", "jmeno", "first name", "firstname", "given name"],
  lastName: ["příjmení", "prijmeni", "last name", "lastname", "family name", "surname"],
  company: ["firma", "company", "organization", "org"],
  phone1: ["telefon", "mobil", "mobile", "phone", "cell"],
  phone2: ["druhý telefon", "druhy telefon", "phone2", "telefon 2"],
  phoneWork: ["práce", "prace", "work", "work phone"],
  email1: ["e-mail", "email", "mail"],
  email2: ["e-mail 2", "email 2", "soukromý e-mail", "private email"],
  birthday: ["narozeniny", "birthday", "bday", "datum narození"],
  address: ["adresa", "address"],
  note: ["poznámka", "poznamka", "note", "notes"],
};

export async function importCsv(
  userId: string,
  fileContent: string,
  options: { overwrite: boolean; action: "preview" | "apply" },
): Promise<ImportPreview & Partial<ImportApplyResult>> {
  // BOM strip
  const content = fileContent.replace(/^﻿/, "");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { totalParsed: 0, newContacts: 0, collisions: 0, collisionsList: [] };
  }

  // Detect separator (sniff počet ; vs , v hlavičce)
  const headerLine = lines[0];
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const sep = semicolons >= commas ? ";" : ",";

  const headers = parseCsvLine(headerLine, sep).map((h) => h.toLowerCase().trim());
  const colMap: Partial<Record<keyof typeof CSV_HEADERS, number>> = {};
  for (const [field, aliases] of Object.entries(CSV_HEADERS)) {
    const idx = headers.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) colMap[field as keyof typeof CSV_HEADERS] = idx;
  }

  const parsed: VCardContact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], sep);
    const firstName = cells[colMap.firstName ?? -1] ?? "";
    const lastName = cells[colMap.lastName ?? -1] ?? "";
    if (!firstName && !lastName) continue;
    const phones: VCardContact["phones"] = [];
    const p1 = cells[colMap.phone1 ?? -1];
    if (p1) phones.push({ number: p1.trim(), label: "CELL" });
    const p2 = cells[colMap.phone2 ?? -1];
    if (p2) phones.push({ number: p2.trim(), label: "OTHER" });
    const pw = cells[colMap.phoneWork ?? -1];
    if (pw) phones.push({ number: pw.trim(), label: "WORK" });
    const emails: VCardContact["emails"] = [];
    const e1 = cells[colMap.email1 ?? -1];
    if (e1) emails.push({ email: e1.toLowerCase().trim(), label: "WORK" });
    const e2 = cells[colMap.email2 ?? -1];
    if (e2) emails.push({ email: e2.toLowerCase().trim(), label: "HOME" });

    const bdayStr = cells[colMap.birthday ?? -1] ?? "";
    const bdayMatch = bdayStr.match(/(\d{4})-?(\d{2})-?(\d{2})/) ?? bdayStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    let birthYear: number | null = null;
    let birthMonth: number | null = null;
    let birthDay: number | null = null;
    if (bdayMatch) {
      if (bdayMatch[1].length === 4) {
        birthYear = parseInt(bdayMatch[1], 10);
        birthMonth = parseInt(bdayMatch[2], 10);
        birthDay = parseInt(bdayMatch[3], 10);
      } else {
        birthDay = parseInt(bdayMatch[1], 10);
        birthMonth = parseInt(bdayMatch[2], 10);
        birthYear = parseInt(bdayMatch[3], 10);
      }
    }

    parsed.push({
      uid: "", // generuje se při apply
      fn: [firstName, lastName].filter(Boolean).join(" ").trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      org: (cells[colMap.company ?? -1] ?? "").trim() || null,
      phones,
      emails,
      addressLines: cells[colMap.address ?? -1] ? [cells[colMap.address ?? -1]] : [],
      birthYear,
      birthMonth,
      birthDay,
      categories: [],
      note: (cells[colMap.note ?? -1] ?? "").trim() || null,
      rev: null,
      kind: "individual",
      groupMemberUids: [],
    });
  }

  return doImport(userId, parsed, options);
}

// ============================================================================
// Společná import logika
// ============================================================================

async function doImport(
  userId: string,
  parsed: VCardContact[],
  options: { overwrite: boolean; action: "preview" | "apply" },
): Promise<ImportPreview & Partial<ImportApplyResult>> {
  // Načti existující kontakty pro collision detection
  const existing = await prisma.contact.findMany({
    where: { userId },
    include: { phones: true, emails: true },
  });

  function phoneKey(num: string): string {
    return num.replace(/\D/g, "").slice(-9);
  }
  const phoneIdx = new Map<string, string>(); // phoneKey → contactId
  const emailIdx = new Map<string, string>();
  for (const c of existing) {
    for (const p of c.phones) {
      const k = phoneKey(p.number);
      if (k) phoneIdx.set(k, c.id);
    }
    for (const e of c.emails) {
      emailIdx.set(e.email.toLowerCase(), c.id);
    }
  }

  const collisions: ImportPreview["collisionsList"] = [];
  const newOnes: VCardContact[] = [];

  for (const p of parsed) {
    let matched: string | null = null;
    let matchReason = "";
    for (const phone of p.phones) {
      const k = phoneKey(phone.number);
      if (k && phoneIdx.has(k)) {
        matched = phoneIdx.get(k)!;
        matchReason = `telefon …${k.slice(-6)}`;
        break;
      }
    }
    if (!matched) {
      for (const em of p.emails) {
        if (emailIdx.has(em.email)) {
          matched = emailIdx.get(em.email)!;
          matchReason = `email ${em.email}`;
          break;
        }
      }
    }

    if (matched) {
      const matchedContact = existing.find((c) => c.id === matched);
      collisions.push({
        importedName: p.fn,
        matchedId: matched,
        matchedName: matchedContact?.displayName ?? "?",
        matchReason,
      });
    } else {
      newOnes.push(p);
    }
  }

  const preview: ImportPreview = {
    totalParsed: parsed.length,
    newContacts: newOnes.length,
    collisions: collisions.length,
    collisionsList: collisions.slice(0, 50),
  };

  if (options.action === "preview") return preview;

  // APPLY
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const p of newOnes) {
    try {
      const newContact = await prisma.contact.create({
        data: {
          userId,
          displayName: p.fn || `${p.firstName} ${p.lastName}`.trim() || "(bez jména)",
          firstName: p.firstName || null,
          lastName: p.lastName || null,
          company: p.org,
          addressLines: p.addressLines,
          birthYear: p.birthYear,
          birthMonth: p.birthMonth,
          birthDay: p.birthDay,
          note: p.note,
          groups: p.categories,
          syncSource: "manual",
          importedFrom: "vcard",
        },
      });
      for (const phone of p.phones) {
        await prisma.phone.create({ data: { contactId: newContact.id, number: normalizePhone(phone.number) ?? phone.number, label: phone.label } }).catch(() => null);
      }
      for (const em of p.emails) {
        await prisma.contactEmail.create({ data: { contactId: newContact.id, email: em.email, label: em.label } }).catch(() => null);
      }
      created++;
    } catch {
      errors++;
    }
  }

  if (options.overwrite) {
    // Overwrite collisions — update matched contact se sloučenými poli
    for (const coll of collisions) {
      const p = parsed.find((x) => x.fn === coll.importedName);
      if (!p) { skipped++; continue; }
      try {
        await prisma.contact.update({
          where: { id: coll.matchedId },
          data: {
            ...(p.firstName ? { firstName: p.firstName } : {}),
            ...(p.lastName ? { lastName: p.lastName } : {}),
            ...(p.org ? { company: p.org } : {}),
            ...(p.note ? { note: p.note } : {}),
            ...(p.birthYear ? { birthYear: p.birthYear } : {}),
            ...(p.birthMonth ? { birthMonth: p.birthMonth } : {}),
            ...(p.birthDay ? { birthDay: p.birthDay } : {}),
          },
        });
        updated++;
      } catch {
        errors++;
      }
    }
  } else {
    skipped = collisions.length;
  }

  return { ...preview, created, updated, skipped, errors };
}

function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === sep && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}
