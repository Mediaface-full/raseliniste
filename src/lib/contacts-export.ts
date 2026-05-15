/**
 * Export kontaktů do VCF a CSV (kontakty_brief.md 5.9).
 *
 * Scope: vše / firma / skupina (dynamicky dle existujících hodnot).
 * Formáty: VCF (vCard 3.0, univerzální) nebo CSV (středník, UTF-8 BOM,
 * Excel-friendly).
 *
 * Firemní export — checkbox omezí pole na 7 základních:
 *   Jméno, Příjmení, Firma, Telefon (mobile prefer), Druhý telefon,
 *   Narozeniny, E-mail (primární prefer).
 */

import { prisma } from "./db";
import { buildVCard, type VCardContact } from "./vcard";

export type ExportFormat = "vcf" | "csv";

export interface ExportOptions {
  format: ExportFormat;
  scope: "all" | { company: string } | { group: string };
  firemniMin?: boolean; // true = jen 7 základních polí
}

export async function generateExport(userId: string, opts: ExportOptions): Promise<{
  content: string;
  filename: string;
  contentType: string;
}> {
  // Filter kontakty
  let where: Parameters<typeof prisma.contact.findMany>[0]["where"] = { userId };
  if (typeof opts.scope === "object" && "company" in opts.scope) {
    where = { ...where, company: opts.scope.company };
  } else if (typeof opts.scope === "object" && "group" in opts.scope) {
    where = { ...where, groups: { has: opts.scope.group } };
  }
  const contacts = await prisma.contact.findMany({
    where,
    include: { phones: true, emails: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  // Filename
  const dateStr = new Date().toISOString().slice(0, 10);
  let scopeLabel = "vse";
  if (typeof opts.scope === "object" && "company" in opts.scope) {
    scopeLabel = `firma_${slugify(opts.scope.company)}`;
  } else if (typeof opts.scope === "object" && "group" in opts.scope) {
    scopeLabel = `skupina_${slugify(opts.scope.group)}`;
  }
  const firemniSuffix = opts.firemniMin ? "_firemni" : "";
  const filename = `kontakty_${scopeLabel}${firemniSuffix}_${dateStr}.${opts.format}`;

  // Generate content
  let content: string;
  let contentType: string;
  if (opts.format === "vcf") {
    content = generateVcf(contacts, opts.firemniMin ?? false);
    contentType = "text/vcard; charset=utf-8";
  } else {
    content = generateCsv(contacts, opts.firemniMin ?? false);
    contentType = "text/csv; charset=utf-8";
  }

  return { content, filename, contentType };
}

function generateVcf(contacts: Awaited<ReturnType<typeof prisma.contact.findMany>>, firemni: boolean): string {
  const cards: string[] = [];
  for (const c of contacts) {
    const phones = (c as { phones?: { number: string; label: string | null }[] }).phones ?? [];
    const emails = (c as { emails?: { email: string; label: string | null }[] }).emails ?? [];
    if (firemni) {
      const mobilePhone = phones.find((p) => p.label?.toLowerCase().includes("mobile") || p.label?.toLowerCase().includes("cell"));
      const workPhone = phones.find((p) => p.label?.toLowerCase() === "work");
      const firstEmail = emails[0]?.email;
      const v: VCardContact = {
        uid: c.icloudUid ?? c.id,
        fn: c.displayName,
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        org: c.company,
        phones: [
          ...(mobilePhone ? [{ number: mobilePhone.number, label: "CELL" }] : []),
          ...(workPhone && workPhone !== mobilePhone ? [{ number: workPhone.number, label: "WORK" }] : []),
        ],
        emails: firstEmail ? [{ email: firstEmail, label: null }] : [],
        addressLines: [],
        birthYear: c.birthYear,
        birthMonth: c.birthMonth,
        birthDay: c.birthDay,
        categories: [],
        note: null,
        rev: null,
        kind: "individual",
        groupMemberUids: [],
      };
      cards.push(buildVCard(v));
    } else {
      const v: VCardContact = {
        uid: c.icloudUid ?? c.id,
        fn: c.displayName,
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        org: c.company,
        phones: phones.map((p) => ({ number: p.number, label: p.label })),
        emails: emails.map((e) => ({ email: e.email, label: e.label })),
        addressLines: c.addressLines,
        birthYear: c.birthYear,
        birthMonth: c.birthMonth,
        birthDay: c.birthDay,
        categories: c.groups,
        note: c.note,
        rev: null,
        kind: "individual",
        groupMemberUids: [],
      };
      cards.push(buildVCard(v));
    }
  }
  return cards.join("");
}

function generateCsv(contacts: Awaited<ReturnType<typeof prisma.contact.findMany>>, firemni: boolean): string {
  const BOM = "﻿";
  const sep = ";";

  if (firemni) {
    const headers = ["Jméno", "Příjmení", "Firma", "Telefon", "Druhý telefon", "Narozeniny", "E-mail"];
    const rows: string[] = [headers.map(csvEscape).join(sep)];
    for (const c of contacts) {
      const phones = (c as { phones?: { number: string; label: string | null }[] }).phones ?? [];
      const emails = (c as { emails?: { email: string; label: string | null }[] }).emails ?? [];
      const mobile = phones.find((p) => p.label?.toLowerCase().includes("mobile") || p.label?.toLowerCase().includes("cell"));
      const work = phones.find((p) => p.label?.toLowerCase() === "work" && p !== mobile);
      const second = work ?? phones.find((p) => p !== mobile);
      const phone1 = mobile?.number ?? phones[0]?.number ?? "";
      const phone2 = second?.number !== phone1 ? second?.number ?? "" : "";
      const bday = c.birthYear && c.birthMonth && c.birthDay
        ? `${c.birthYear}-${String(c.birthMonth).padStart(2, "0")}-${String(c.birthDay).padStart(2, "0")}`
        : "";
      const email = emails[0]?.email ?? "";
      rows.push([c.firstName ?? "", c.lastName ?? "", c.company ?? "", phone1, phone2, bday, email].map(csvEscape).join(sep));
    }
    return BOM + rows.join("\r\n") + "\r\n";
  }

  const headers = ["Jméno", "Příjmení", "Firma", "Telefony", "E-maily", "Adresa", "Narozeniny", "Skupiny", "Poznámka", "VIP", "Tým", "Klient slug"];
  const rows: string[] = [headers.map(csvEscape).join(sep)];
  for (const c of contacts) {
    const phones = (c as { phones?: { number: string; label: string | null }[] }).phones ?? [];
    const emails = (c as { emails?: { email: string; label: string | null }[] }).emails ?? [];
    const bday = c.birthYear && c.birthMonth && c.birthDay
      ? `${c.birthYear}-${String(c.birthMonth).padStart(2, "0")}-${String(c.birthDay).padStart(2, "0")}`
      : "";
    rows.push([
      c.firstName ?? "",
      c.lastName ?? "",
      c.company ?? "",
      phones.map((p) => `${p.label ? `${p.label}:` : ""}${p.number}`).join(" | "),
      emails.map((e) => `${e.label ? `${e.label}:` : ""}${e.email}`).join(" | "),
      c.addressLines.join(" / "),
      bday,
      c.groups.join(", "),
      c.note ?? "",
      c.isVip ? "ano" : "",
      c.isTeam ? "ano" : "",
      c.clientTag ?? "",
    ].map(csvEscape).join(sep));
  }
  return BOM + rows.join("\r\n") + "\r\n";
}

function csvEscape(value: string): string {
  if (value == null) return "";
  const s = String(value);
  if (s.includes(";") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
