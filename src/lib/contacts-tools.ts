/**
 * Hromadné nástroje nad kontakty (kontakty_brief.md 5.8 C, D).
 *
 * Find & Replace + Normalizace telefonů na +420.
 * Operace jsou idempotentní + vrátí preview změn před aplikací.
 */

import { prisma } from "./db";

// ============================================================================
// FIND & REPLACE
// ============================================================================

export type ContactColumn =
  | "displayName"
  | "firstName"
  | "lastName"
  | "company"
  | "note"
  | "phones"      // hledá v Phone.number
  | "emails";     // hledá v ContactEmail.email

export interface FindReplaceInput {
  column: ContactColumn;
  find: string;
  replace: string;
  regex: boolean;
  caseSensitive: boolean;
  contactIds?: string[]; // omezit na podmnožinu (filtered)
}

export interface FindReplacePreview {
  contactId: string;
  displayName: string;
  field: string; // "Phone:+420..." apod. (pro phones/emails)
  before: string;
  after: string;
}

function buildMatcher(input: FindReplaceInput): RegExp {
  const flags = input.caseSensitive ? "g" : "gi";
  if (input.regex) {
    return new RegExp(input.find, flags);
  }
  const escaped = input.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, flags);
}

export async function findReplacePreview(
  userId: string,
  input: FindReplaceInput,
  maxPreview = 20,
): Promise<{ preview: FindReplacePreview[]; total: number }> {
  const matcher = buildMatcher(input);

  // Načti kandidáty
  const where = input.contactIds && input.contactIds.length > 0
    ? { userId, id: { in: input.contactIds } }
    : { userId };

  const contacts = await prisma.contact.findMany({
    where,
    include: { phones: true, emails: true },
  });

  const changes: FindReplacePreview[] = [];
  for (const c of contacts) {
    if (input.column === "phones") {
      for (const p of c.phones) {
        if (matcher.test(p.number)) {
          matcher.lastIndex = 0;
          const after = p.number.replace(matcher, input.replace);
          if (after !== p.number) {
            changes.push({ contactId: c.id, displayName: c.displayName, field: `Telefon ${p.label ?? "?"}`, before: p.number, after });
          }
        }
      }
    } else if (input.column === "emails") {
      for (const e of c.emails) {
        if (matcher.test(e.email)) {
          matcher.lastIndex = 0;
          const after = e.email.replace(matcher, input.replace);
          if (after !== e.email) {
            changes.push({ contactId: c.id, displayName: c.displayName, field: `E-mail ${e.label ?? "?"}`, before: e.email, after });
          }
        }
      }
    } else {
      const value = (c[input.column] as string | null) ?? "";
      if (!value) continue;
      if (matcher.test(value)) {
        matcher.lastIndex = 0;
        const after = value.replace(matcher, input.replace);
        if (after !== value) {
          changes.push({ contactId: c.id, displayName: c.displayName, field: input.column, before: value, after });
        }
      }
    }
  }

  return { preview: changes.slice(0, maxPreview), total: changes.length };
}

export async function findReplaceApply(
  userId: string,
  input: FindReplaceInput,
): Promise<{ updated: number }> {
  const matcher = buildMatcher(input);
  const where = input.contactIds && input.contactIds.length > 0
    ? { userId, id: { in: input.contactIds } }
    : { userId };

  const contacts = await prisma.contact.findMany({
    where,
    include: { phones: true, emails: true },
  });

  let updated = 0;

  for (const c of contacts) {
    if (input.column === "phones") {
      for (const p of c.phones) {
        matcher.lastIndex = 0;
        if (matcher.test(p.number)) {
          matcher.lastIndex = 0;
          const after = p.number.replace(matcher, input.replace);
          if (after !== p.number) {
            await prisma.phone.update({ where: { id: p.id }, data: { number: after } }).catch(() => null);
            updated++;
          }
        }
      }
    } else if (input.column === "emails") {
      for (const e of c.emails) {
        matcher.lastIndex = 0;
        if (matcher.test(e.email)) {
          matcher.lastIndex = 0;
          const after = e.email.replace(matcher, input.replace);
          if (after !== e.email) {
            await prisma.contactEmail.update({ where: { id: e.id }, data: { email: after } }).catch(() => null);
            updated++;
          }
        }
      }
    } else {
      const value = (c[input.column] as string | null) ?? "";
      if (!value) continue;
      matcher.lastIndex = 0;
      if (matcher.test(value)) {
        matcher.lastIndex = 0;
        const after = value.replace(matcher, input.replace);
        if (after !== value) {
          await prisma.contact.update({ where: { id: c.id }, data: { [input.column]: after } });
          updated++;
        }
      }
    }
  }

  return { updated };
}

// ============================================================================
// Normalizace +420
// ============================================================================

// CZ mobilní prefixy: 60[1-8], 70[2-9], 72-77x, 79x
// CZ pevné: 2[0-9], 3[1-9], 38[0-9], 4[0-9], 5[0-9]
function isCzNumberLikely(digits9: string): boolean {
  if (digits9.length !== 9) return false;
  const first2 = digits9.slice(0, 2);
  const first3 = digits9.slice(0, 3);

  // Mobile rozsahy
  if (first3.match(/^60[1-8]/)) return true;
  if (first3.match(/^70[2-9]/)) return true;
  if (first2.match(/^7[2-7]/)) return true;
  if (first2 === "79") return true;

  // Landline
  if (first2.match(/^2/)) return true;
  if (first2.match(/^3[1-9]/)) return true;
  if (first3.match(/^38/)) return true;
  if (first2.match(/^4/)) return true;
  if (first2.match(/^5/)) return true;

  return false;
}

export interface PhoneNormalizationCandidate {
  contactId: string;
  contactName: string;
  phoneId: string;
  original: string;
  normalized: string;
  confidence: "high" | "ambiguous"; // high = CZ-matching, ambiguous = 9 digits ale ne CZ
}

export async function findPhoneNormalizationCandidates(
  userId: string,
): Promise<PhoneNormalizationCandidate[]> {
  const phones = await prisma.phone.findMany({
    where: { contact: { userId } },
    include: { contact: { select: { id: true, displayName: true } } },
  });

  const out: PhoneNormalizationCandidate[] = [];
  for (const p of phones) {
    const raw = p.number.trim();
    // Skip already-prefixed
    if (raw.startsWith("+") || raw.startsWith("00")) continue;
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 9) continue;

    const isCz = isCzNumberLikely(digits);
    const normalized = `+420 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
    out.push({
      contactId: p.contact.id,
      contactName: p.contact.displayName,
      phoneId: p.id,
      original: raw,
      normalized,
      confidence: isCz ? "high" : "ambiguous",
    });
  }

  return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
}

export async function applyPhoneNormalizations(
  userId: string,
  phoneIds: string[],
): Promise<{ updated: number }> {
  const phones = await prisma.phone.findMany({
    where: {
      id: { in: phoneIds },
      contact: { userId }, // bezpečnost: jen vlastní
    },
  });

  let updated = 0;
  for (const p of phones) {
    const raw = p.number.trim();
    if (raw.startsWith("+") || raw.startsWith("00")) continue;
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 9) continue;
    const normalized = `+420 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
    await prisma.phone.update({ where: { id: p.id }, data: { number: normalized } }).catch(() => null);
    updated++;
  }
  return { updated };
}
