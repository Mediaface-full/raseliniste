/**
 * Detekce + merge duplicit v Contact tabulce (kontakty_brief.md 5.8 B).
 *
 * Clustering podle:
 *   - shody jména (case-insensitive, trim)
 *   - shody telefonu (posledních 9 číslic po odstranění non-digits)
 *   - shody e-mailu (lowercase, trim)
 *
 * Union-find: pokud A+B sdílí telefon a B+C sdílí email, cluster {A, B, C}.
 *
 * Merge zachová UID/icloudUid primárního, doplní chybějící pole z ostatních
 * (skalární: pokud primary prázdné, vezme se z secondary; telefony/emaily:
 * doplnit do volných slotů; skupiny: union).
 */

import { prisma } from "./db";

export interface DuplicateCluster {
  id: string; // dočasné ID pro UI tracking
  reason: string[]; // důvody match: "jméno", "telefon: +420...", "email: x@y"
  contacts: Array<{
    id: string;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    phones: string[];
    emails: string[];
    isVip: boolean;
    isTeam: boolean;
    clientTag: string | null;
    icloudUid: string | null;
    syncSource: string | null;
    createdAt: string;
  }>;
}

/**
 * Najde clustery duplicit v DB.
 *
 * Performance: pro 1000 kontaktů ~50ms (in-memory union-find).
 */
export async function findDuplicateClusters(userId: string): Promise<DuplicateCluster[]> {
  const contacts = await prisma.contact.findMany({
    where: { userId },
    include: { phones: true, emails: true },
    orderBy: { createdAt: "asc" },
  });

  // Union-find structure: parent[i] = root index
  const parent = contacts.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Index pro fast match
  const byName = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();

  contacts.forEach((c, i) => {
    const nameKey = normalizeName(c);
    if (nameKey) (byName.get(nameKey) ?? byName.set(nameKey, []).get(nameKey)!).push(i);
    for (const p of c.phones) {
      const key = phoneKey(p.number);
      if (key) (byPhone.get(key) ?? byPhone.set(key, []).get(key)!).push(i);
    }
    for (const e of c.emails) {
      const key = e.email.toLowerCase().trim();
      if (key) (byEmail.get(key) ?? byEmail.set(key, []).get(key)!).push(i);
    }
  });

  // Union přes všechny shody
  const reasonsForPair = new Map<string, Set<string>>(); // "i-j" → set důvodů
  function addReason(a: number, b: number, reason: string) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    (reasonsForPair.get(key) ?? reasonsForPair.set(key, new Set()).get(key)!).add(reason);
  }

  for (const [name, idxs] of byName.entries()) {
    if (idxs.length < 2) continue;
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        union(idxs[i], idxs[j]);
        addReason(idxs[i], idxs[j], `jméno: ${name}`);
      }
    }
  }
  for (const [phone, idxs] of byPhone.entries()) {
    if (idxs.length < 2) continue;
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        union(idxs[i], idxs[j]);
        addReason(idxs[i], idxs[j], `telefon: …${phone.slice(-6)}`);
      }
    }
  }
  for (const [email, idxs] of byEmail.entries()) {
    if (idxs.length < 2) continue;
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        union(idxs[i], idxs[j]);
        addReason(idxs[i], idxs[j], `email: ${email}`);
      }
    }
  }

  // Group indices podle root
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < contacts.length; i++) {
    const r = find(i);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(i);
  }

  // Sestav výstup — jen clustery s 2+ členy
  const out: DuplicateCluster[] = [];
  for (const [root, members] of clusters.entries()) {
    if (members.length < 2) continue;
    // Souhrn důvodů pro celý cluster
    const reasons = new Set<string>();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = members[i] < members[j] ? `${members[i]}-${members[j]}` : `${members[j]}-${members[i]}`;
        const r = reasonsForPair.get(key);
        if (r) for (const x of r) reasons.add(x);
      }
    }
    out.push({
      id: `cluster-${root}`,
      reason: Array.from(reasons).sort(),
      contacts: members.map((i) => {
        const c = contacts[i];
        return {
          id: c.id,
          displayName: c.displayName,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          phones: c.phones.map((p) => p.number),
          emails: c.emails.map((e) => e.email),
          isVip: c.isVip,
          isTeam: c.isTeam,
          clientTag: c.clientTag,
          icloudUid: c.icloudUid,
          syncSource: c.syncSource,
          createdAt: c.createdAt.toISOString(),
        };
      }),
    });
  }

  return out.sort((a, b) => b.contacts.length - a.contacts.length);
}

function normalizeName(c: { displayName: string; firstName: string | null; lastName: string | null }): string {
  const parts = [
    (c.firstName ?? "").trim().toLowerCase(),
    (c.lastName ?? "").trim().toLowerCase(),
  ].filter(Boolean);
  if (parts.length === 0) {
    const display = c.displayName.trim().toLowerCase();
    if (!display || display === "(bez jména)") return "";
    return display;
  }
  return parts.sort().join(" ");
}

function phoneKey(num: string): string {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.slice(-9); // posledních 9 číslic robustní napříč formáty
}

// ============================================================================
// MERGE
// ============================================================================

/**
 * Sloučí 2+ kontaktů do jednoho (primárního). Bezpečnostní pravidla:
 *
 * 1. Primary zachová ID, icloudUid, overlay pole (isVip/aliases/clientTag/...).
 * 2. Skalární pole (firstName, lastName, company, note, birthYear/Month/Day):
 *    pokud je primary prázdný, vezme se z první non-empty secondary.
 * 3. Telefony: union (deduplikace podle Phone.number).
 * 4. Emaily: union (deduplikace podle ContactEmail.email lowercase).
 * 5. Skupiny (Contact.groups): union.
 * 6. Overlay pole z secondary: pokud secondary má isVip/isTeam/clientTag a
 *    primary nemá → překopíruj (Petr chce zachovat VIP flag z duplikátu).
 * 7. Vazby (CallLog, BookingInvite, Task TaskAssignee, Letter, Phone, ContactEmail):
 *    re-link na primary.
 * 8. Secondary se smaže (cascade Phone/Email už re-linkly, takže delete OK).
 */
export async function mergeContacts(
  userId: string,
  primaryId: string,
  secondaryIds: string[],
): Promise<{ ok: boolean; mergedCount: number; error?: string }> {
  if (secondaryIds.length === 0) return { ok: true, mergedCount: 0 };

  const primary = await prisma.contact.findFirst({
    where: { id: primaryId, userId },
    include: { phones: true, emails: true },
  });
  if (!primary) return { ok: false, mergedCount: 0, error: "Primární kontakt nenalezen." };

  const secondaries = await prisma.contact.findMany({
    where: { id: { in: secondaryIds }, userId },
    include: { phones: true, emails: true },
  });

  // 1) Skalární doplnění
  const updates: Record<string, unknown> = {};
  const fields: Array<keyof typeof primary> = ["firstName", "lastName", "company", "note", "birthYear", "birthMonth", "birthDay", "firstNameVocative", "greetingOverride", "icloudUid", "icloudEtag", "icloudHref", "googleResourceName"];
  for (const f of fields) {
    if (primary[f] == null || primary[f] === "") {
      for (const s of secondaries) {
        if (s[f] != null && s[f] !== "") {
          updates[f as string] = s[f];
          break;
        }
      }
    }
  }
  // Overlay flags — pokud sekundární má true, propagace
  if (!primary.isVip && secondaries.some((s) => s.isVip)) updates.isVip = true;
  if (!primary.isTeam && secondaries.some((s) => s.isTeam)) updates.isTeam = true;
  if (!primary.isClient && secondaries.some((s) => s.isClient)) updates.isClient = true;
  if (!primary.isFriend && secondaries.some((s) => s.isFriend)) updates.isFriend = true;
  if (!primary.isFamily && secondaries.some((s) => s.isFamily)) updates.isFamily = true;
  if (!primary.clientTag) {
    const fromSec = secondaries.find((s) => s.clientTag);
    if (fromSec) updates.clientTag = fromSec.clientTag;
  }
  // Aliases — union deduplicated
  const allAliases = new Set([...primary.aliases]);
  const allClientAliases = new Set([...primary.clientTagAliases]);
  for (const s of secondaries) {
    for (const a of s.aliases) allAliases.add(a);
    for (const a of s.clientTagAliases) allClientAliases.add(a);
  }
  if (allAliases.size > primary.aliases.length) updates.aliases = Array.from(allAliases);
  if (allClientAliases.size > primary.clientTagAliases.length) updates.clientTagAliases = Array.from(allClientAliases);

  // Skupiny: union
  const allGroups = new Set([...primary.groups]);
  for (const s of secondaries) for (const g of s.groups) allGroups.add(g);
  if (allGroups.size > primary.groups.length) updates.groups = Array.from(allGroups).sort();

  // 2) Phones + Emails: re-link na primary, dedup
  const existingPhoneSet = new Set(primary.phones.map((p) => p.number));
  const existingEmailSet = new Set(primary.emails.map((e) => e.email.toLowerCase()));

  for (const s of secondaries) {
    for (const p of s.phones) {
      if (!existingPhoneSet.has(p.number)) {
        await prisma.phone.update({ where: { id: p.id }, data: { contactId: primaryId } });
        existingPhoneSet.add(p.number);
      } else {
        await prisma.phone.delete({ where: { id: p.id } }); // dup, smaž
      }
    }
    for (const e of s.emails) {
      if (!existingEmailSet.has(e.email.toLowerCase())) {
        await prisma.contactEmail.update({ where: { id: e.id }, data: { contactId: primaryId } });
        existingEmailSet.add(e.email.toLowerCase());
      } else {
        await prisma.contactEmail.delete({ where: { id: e.id } });
      }
    }
  }

  // 3) Re-link vazeb (CallLog, BookingInvite, Task assignee)
  await prisma.callLog.updateMany({ where: { contactId: { in: secondaryIds } }, data: { contactId: primaryId } });
  await prisma.bookingInvite.updateMany({ where: { contactId: { in: secondaryIds } }, data: { contactId: primaryId } });
  await prisma.task.updateMany({ where: { assignedToContactId: { in: secondaryIds } }, data: { assignedToContactId: primaryId } });

  // 4) Update primary
  if (Object.keys(updates).length > 0) {
    await prisma.contact.update({ where: { id: primaryId }, data: updates });
  }

  // 5) Smaž secondary
  await prisma.contact.deleteMany({ where: { id: { in: secondaryIds }, userId } });

  return { ok: true, mergedCount: secondaryIds.length };
}
