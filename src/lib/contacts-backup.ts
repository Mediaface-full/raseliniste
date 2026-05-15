/**
 * Záloha + obnova kontaktů (kontakty_brief.md 5.8 F + sekce 9 persistence).
 *
 * Před každým PUT (iCloud sync push) / DELETE / MERGE secondary se vyrobí
 * snapshot Contact → vCard 3.0 string → ContactBackup row.
 *
 * UI listuje posledních 80 záloh, klikem se obnoví jako nový kontakt
 * (nebo overwrite existujícího pokud UID match).
 */

import { prisma } from "./db";
import { buildVCard, parseVCardFull, type VCardContact } from "./vcard";
import { normalizePhone } from "./phone";

const MAX_BACKUPS_LIST = 80;

export async function backupContact(
  userId: string,
  contactId: string,
  action: "before_put" | "before_delete" | "before_merge",
): Promise<void> {
  const c = await prisma.contact.findFirst({
    where: { id: contactId, userId },
    include: { phones: true, emails: true },
  });
  if (!c) return; // ticho — nelze zálohovat neexistující

  const vcard: VCardContact = {
    uid: c.icloudUid ?? c.id,
    fn: c.displayName,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    org: c.company,
    phones: c.phones.map((p) => ({ number: p.number, label: p.label })),
    emails: c.emails.map((e) => ({ email: e.email, label: e.label })),
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
  const vcardSnapshot = buildVCard(vcard);

  await prisma.contactBackup.create({
    data: {
      userId,
      vcardSnapshot,
      contactId: c.id,
      displayName: c.displayName,
      action,
    },
  });

  // Cleanup — drž jen posledních N záloh per user (jinak by tabulka rostla bez limitu)
  // Mažeme až nad threshold (500), 80 je jen UI list limit.
  const TOTAL_KEEP = 500;
  const count = await prisma.contactBackup.count({ where: { userId } });
  if (count > TOTAL_KEEP) {
    const oldest = await prisma.contactBackup.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: count - TOTAL_KEEP,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await prisma.contactBackup.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } });
    }
  }
}

export async function listBackups(userId: string): Promise<Array<{
  id: string;
  displayName: string;
  action: string;
  createdAt: string;
  contactId: string | null;
}>> {
  const backups = await prisma.contactBackup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_BACKUPS_LIST,
    select: { id: true, displayName: true, action: true, createdAt: true, contactId: true },
  });
  return backups.map((b) => ({
    id: b.id,
    displayName: b.displayName,
    action: b.action,
    createdAt: b.createdAt.toISOString(),
    contactId: b.contactId,
  }));
}

export async function restoreBackup(userId: string, backupId: string): Promise<{
  ok: boolean;
  restoredContactId?: string;
  error?: string;
}> {
  const backup = await prisma.contactBackup.findFirst({
    where: { id: backupId, userId },
  });
  if (!backup) return { ok: false, error: "Záloha nenalezena." };

  const parsed = parseVCardFull(backup.vcardSnapshot);
  if (!parsed) return { ok: false, error: "vCard záloha je poškozená." };

  // Pokud Contact stále existuje (contactId match) — update; jinak vytvoř nový
  let restoredId: string;
  const existing = backup.contactId
    ? await prisma.contact.findFirst({ where: { id: backup.contactId, userId } })
    : null;

  if (existing) {
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        displayName: parsed.fn,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        company: parsed.org,
        addressLines: parsed.addressLines,
        birthYear: parsed.birthYear,
        birthMonth: parsed.birthMonth,
        birthDay: parsed.birthDay,
        note: parsed.note,
        groups: parsed.categories,
      },
    });
    // Reset phones/emails na verzi v záloze
    await prisma.phone.deleteMany({ where: { contactId: existing.id } });
    await prisma.contactEmail.deleteMany({ where: { contactId: existing.id } });
    for (const p of parsed.phones) {
      await prisma.phone.create({ data: { contactId: existing.id, number: normalizePhone(p.number) ?? p.number, label: p.label } }).catch(() => null);
    }
    for (const e of parsed.emails) {
      await prisma.contactEmail.create({ data: { contactId: existing.id, email: e.email, label: e.label } }).catch(() => null);
    }
    restoredId = existing.id;
  } else {
    // Vytvoř nový (zachovat icloudUid pokud byl)
    const created = await prisma.contact.create({
      data: {
        userId,
        displayName: parsed.fn,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        company: parsed.org,
        addressLines: parsed.addressLines,
        birthYear: parsed.birthYear,
        birthMonth: parsed.birthMonth,
        birthDay: parsed.birthDay,
        note: parsed.note,
        groups: parsed.categories,
        icloudUid: parsed.uid || null,
        syncSource: "restore",
        importedFrom: "backup",
      },
    });
    for (const p of parsed.phones) {
      await prisma.phone.create({ data: { contactId: created.id, number: normalizePhone(p.number) ?? p.number, label: p.label } }).catch(() => null);
    }
    for (const e of parsed.emails) {
      await prisma.contactEmail.create({ data: { contactId: created.id, email: e.email, label: e.label } }).catch(() => null);
    }
    restoredId = created.id;
  }

  return { ok: true, restoredContactId: restoredId };
}
