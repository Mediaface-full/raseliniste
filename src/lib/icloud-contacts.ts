/**
 * iCloud Contacts sync — high-level logika.
 *
 * Petr 2026-05-14 (kontakty_brief.md fáze 1.4):
 *   - Pull: iCloud → Rašeliniště DB (s overlay model)
 *   - Push: Rašeliniště → iCloud (po editaci v tabulce)
 *   - Match: existující Contact se zkusí napárovat na iCloud UID podle
 *     telefonu/emailu (exact match) — pokud sedne, propojit a zachovat
 *     overlay pole (isVip/aliases/clientTag/callLogToken/isTeam/...);
 *     jinak založit nový Contact.
 *
 * iCloud drží core fields (jméno, telefony, emaily, adresa, narozeniny,
 * firma, skupiny). Rašeliniště drží overlay — ten iCloud nevidí, sync
 * se ho netýká.
 */

import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import {
  discoverAddressbook,
  listAddressbookItems,
  fetchAddressbookItems,
  putVCard,
  type CardDavCredentials,
} from "./carddav";
import { parseVCardFull, buildVCard, type VCardContact } from "./vcard";
import { normalizePhone } from "./phone";
import { backupContact } from "./contacts-backup";

export interface SyncStats {
  ok: boolean;
  pulled: number;          // počet stažených vCard
  created: number;         // nové Contacts v DB
  updated: number;         // existující napárovaný + obohacen
  matched: number;         // existujicí matched podle phone/email
  groups: number;          // počet zpracovaných skupin
  errors: number;
  durationMs: number;
  error?: string;
}

// ============================================================================
// CREDENTIALS
// ============================================================================

/**
 * iCloud credentials sdílí provider="icloud" s kalendářem (icloud-calendar.ts).
 * Config field má `appleId` (z calendar setupu) — pro kontakty stačí použít
 * stejný row. Petr nemusí zadávat credentials znovu.
 */
export async function getIcloudCredentials(userId: string): Promise<CardDavCredentials | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
  });
  if (!integration) return null;

  const password = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  // Config field může mít buď `appleId` (z calendar setupu icloud-calendar.ts)
  // nebo `username` (legacy / náš nový setup) — tolerantní lookup.
  const config = (integration.config ?? {}) as {
    appleId?: string;
    username?: string;
    contactsServerUrl?: string;
  };
  const username = config.appleId ?? config.username;
  if (!username) return null;

  return {
    username,
    password,
    serverUrl: config.contactsServerUrl ?? "https://contacts.icloud.com",
  };
}

/**
 * Cache addressbook URL po prvním discovery (pro rychlejší další sync).
 */
export async function getCachedAddressbookUrl(userId: string): Promise<string | null> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
  });
  const config = (integration?.config ?? {}) as { contactsAddressbookUrl?: string };
  return config.contactsAddressbookUrl ?? null;
}

export async function setCachedAddressbookUrl(userId: string, url: string): Promise<void> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
  });
  if (!integration) return;
  const oldConfig = (integration.config ?? {}) as Record<string, unknown>;
  await prisma.userIntegration.update({
    where: { userId_provider: { userId, provider: "icloud" } },
    data: { config: { ...oldConfig, contactsAddressbookUrl: url } },
  });
}

// ============================================================================
// PULL — iCloud → DB
// ============================================================================

/**
 * Plný pull: stáhne všechny vCardy z iCloud addressbooku, napáruje na
 * existující Contacts (podle phone/email), zbytek založí jako nové.
 *
 * Skupiny (vCard s KIND:group) se zpracují zvlášť — vytvoří ContactGroup
 * řádky a denormalizují se na Contact.groups (pro UI).
 *
 * Overlay pole (isVip/aliases/...) se NETÝKÁ — sync je nepřepisuje.
 */
export async function pullIcloudContacts(userId: string): Promise<SyncStats> {
  const start = Date.now();
  const stats: SyncStats = {
    ok: false,
    pulled: 0,
    created: 0,
    updated: 0,
    matched: 0,
    groups: 0,
    errors: 0,
    durationMs: 0,
  };

  const creds = await getIcloudCredentials(userId);
  if (!creds) {
    stats.error = "iCloud credentials nejsou nakonfigurované. Doplň Apple ID + app password v /settings/integrations/icloud.";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  try {
    // Discovery (jednou — Apple addressbook URL se nemění)
    let addressbookUrl = await getCachedAddressbookUrl(userId);
    if (!addressbookUrl) {
      addressbookUrl = await discoverAddressbook(creds);
      await setCachedAddressbookUrl(userId, addressbookUrl);
    }

    // List všech itemů (jen href + etag — žádný obsah)
    const items = await listAddressbookItems(addressbookUrl, creds);
    stats.pulled = items.length;

    // Fetch obsahu vCard
    const fetched = await fetchAddressbookItems(addressbookUrl, creds, items.map((i) => i.href));

    // Parse + dispatch (kontakt vs skupina)
    const contacts: Array<{ item: typeof fetched[number]; parsed: VCardContact }> = [];
    const groups: Array<{ item: typeof fetched[number]; parsed: VCardContact }> = [];
    for (const f of fetched) {
      if (!f.vcard) continue;
      const parsed = parseVCardFull(f.vcard);
      if (!parsed) continue;
      if (parsed.kind === "group") groups.push({ item: f, parsed });
      else contacts.push({ item: f, parsed });
    }

    // 1) Upsert kontaktů — match podle telefonu / emailu / icloudUid
    for (const { item, parsed } of contacts) {
      try {
        await upsertContact(userId, parsed, item.href, item.etag, stats);
      } catch (e) {
        console.warn(`[icloud-sync] contact ${parsed.uid} err:`, e instanceof Error ? e.message : e);
        stats.errors++;
      }
    }

    // 2) Skupiny — denormalizuj na ContactGroup tabulku + Contact.groups pole
    for (const { item, parsed } of groups) {
      try {
        await upsertGroup(userId, parsed, item.href, item.etag);
        stats.groups++;
      } catch (e) {
        console.warn(`[icloud-sync] group ${parsed.uid} err:`, e instanceof Error ? e.message : e);
        stats.errors++;
      }
    }

    // 3) Po skupinách: aktualizuj Contact.groups pole z ContactGroup.memberUids
    await refreshContactGroupsField(userId);

    await prisma.userIntegration.updateMany({
      where: { userId, provider: "icloud" },
      data: { lastUsedAt: new Date(), lastError: null },
    });

    stats.ok = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stats.error = msg;
    await prisma.userIntegration.updateMany({
      where: { userId, provider: "icloud" },
      data: { lastError: msg.slice(0, 1000) },
    }).catch(() => null);
  }

  stats.durationMs = Date.now() - start;
  console.log(`[icloud-sync] userId=${userId} pulled=${stats.pulled} created=${stats.created} matched=${stats.matched} updated=${stats.updated} groups=${stats.groups} errors=${stats.errors} duration=${stats.durationMs}ms`);
  return stats;
}

// ============================================================================
// MATCH + UPSERT (core sync logika)
// ============================================================================

async function upsertContact(
  userId: string,
  parsed: VCardContact,
  href: string,
  etag: string,
  stats: SyncStats,
): Promise<void> {
  // 1) Match podle icloudUid (re-sync existujícího)
  let existing = parsed.uid
    ? await prisma.contact.findFirst({
        where: { userId, icloudUid: parsed.uid },
        include: { phones: true, emails: true },
      })
    : null;

  // 2) Match podle telefonu (phoneKey = posledních 9 číslic, robustní napříč
  //    formáty) nebo emailu (lowercase).
  //
  //    PETR 2026-05-15 (po 3x duplicity): match je teď přes VŠECHNY kontakty
  //    (i ty s icloudUid), nejen unpaired. Apple totiž může změnit UID mezi
  //    syncy (edit v Apple Contacts app vygeneruje nový UID), L1 by selhal
  //    a L2 by ignoroval starý kontakt s předchozím UID → vznikla duplicita.
  //
  //    Match preferenčně na kontakt BEZ icloudUid (pravý duplikát z manualu/
  //    Things), pak na kontakt s icloudUid (UID rotation case).
  if (!existing) {
    const parsedPhoneKeys = parsed.phones
      .map((p) => p.number.replace(/\D/g, "").slice(-9))
      .filter((k) => k.length >= 6);
    const emails = parsed.emails.map((e) => e.email.toLowerCase());

    if (parsedPhoneKeys.length > 0 || emails.length > 0) {
      // Fetch ALL kandidáty (icloudUid null i not-null) — JS match
      const candidates = await prisma.contact.findMany({
        where: { userId },
        include: { phones: true, emails: true },
      });

      // Najdi všechny s overlapem (phoneKey nebo email)
      const matches = candidates.filter((c) => {
        // Skip ten s parsed.uid (L1 selhal nebo UID rotation — ale stále stejný kontakt)
        if (parsed.uid && c.icloudUid === parsed.uid) return false;
        const cPhoneKeys = c.phones.map((p) => p.number.replace(/\D/g, "").slice(-9));
        if (parsedPhoneKeys.some((k) => k && cPhoneKeys.includes(k))) return true;
        const cEmails = c.emails.map((e) => e.email.toLowerCase());
        if (emails.some((e) => e && cEmails.includes(e))) return true;
        return false;
      });

      // Preferenční pořadí: unpaired (icloudUid null) → s icloudUid (UID rotation)
      existing = matches.find((c) => !c.icloudUid)
        ?? matches.find((c) => c.icloudUid)
        ?? null;
      if (existing) stats.matched++;
    }
  }

  // 3) Sestav core data z parsed vCard
  const coreData = {
    icloudUid: parsed.uid || null,
    icloudEtag: etag,
    icloudHref: href,
    lastIcloudSyncAt: new Date(),
    syncSource: "icloud" as const,
    company: parsed.org,
    addressLines: parsed.addressLines,
    birthYear: parsed.birthYear,
    birthMonth: parsed.birthMonth,
    birthDay: parsed.birthDay,
    // Skupiny vyplníme až po zpracování všech groups vCardů (refreshContactGroupsField)
  };

  if (existing) {
    // Bezpečnost: pokud má kontakt už icloudUid (re-sync), iCloud je
    // primárka — replace phones/emails. Jinak (prvni match z manual/Things)
    // **union** — zachovat lokální + přidat iCloud (nezmizí VIPka lookup
    // ani Things-imported telefony které iCloud ještě nemá).
    const isReSync = Boolean(existing.icloudUid);

    // UPDATE — core fields přebíráme z iCloudu, overlay (isVip/aliases/...) NETKAME
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...coreData,
        // displayName přepíšeme jen pokud iCloud má rozumné jméno
        ...(parsed.fn ? { displayName: parsed.fn } : {}),
        ...(parsed.firstName ? { firstName: parsed.firstName } : {}),
        ...(parsed.lastName ? { lastName: parsed.lastName } : {}),
      },
    });

    if (isReSync) {
      await replacePhonesAndEmails(existing.id, parsed);
    } else {
      await mergePhonesAndEmails(existing.id, parsed);
    }
    stats.updated++;
  } else {
    // CREATE
    const created = await prisma.contact.create({
      data: {
        userId,
        displayName: parsed.fn || [parsed.firstName, parsed.lastName].filter(Boolean).join(" ") || "(bez jména)",
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        importedFrom: "icloud",
        externalId: parsed.uid || null,
        ...coreData,
      },
    });
    await replacePhonesAndEmails(created.id, parsed);
    stats.created++;
  }
}

/**
 * RE-SYNC — iCloud je primárka. Smaž lokální, nahraď iCloud verzí.
 * Použít jen když existing.icloudUid je nastavený (= už byl spárovaný).
 */
async function replacePhonesAndEmails(contactId: string, parsed: VCardContact): Promise<void> {
  await prisma.phone.deleteMany({ where: { contactId } });
  await prisma.contactEmail.deleteMany({ where: { contactId } });

  const phones = parsed.phones
    .map((p) => ({ number: normalizePhone(p.number) ?? p.number, label: p.label }))
    .filter((p) => p.number);
  if (phones.length > 0) {
    await prisma.phone.createMany({
      data: phones.map((p) => ({ contactId, number: p.number, label: p.label })),
      skipDuplicates: true,
    });
  }

  const emails = parsed.emails.filter((e) => e.email);
  if (emails.length > 0) {
    await prisma.contactEmail.createMany({
      data: emails.map((e) => ({ contactId, email: e.email, label: e.label })),
      skipDuplicates: true,
    });
  }
}

/**
 * FIRST MATCH — union: zachovat lokální + doplnit iCloud položky které
 * lokálně chybí. Bezpečné při prvním párování existujícího Contact
 * (z Things import / Google / manual) na iCloud vCard.
 *
 * Po prvním sync má kontakt icloudUid → další re-sync používá replace.
 */
async function mergePhonesAndEmails(contactId: string, parsed: VCardContact): Promise<void> {
  const existing = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { phones: true, emails: true },
  });
  if (!existing) return;

  const existingPhoneSet = new Set(existing.phones.map((p) => p.number));
  const existingEmailSet = new Set(existing.emails.map((e) => e.email.toLowerCase()));

  const newPhones = parsed.phones
    .map((p) => ({ number: normalizePhone(p.number) ?? p.number, label: p.label }))
    .filter((p) => p.number && !existingPhoneSet.has(p.number));

  const newEmails = parsed.emails
    .map((e) => ({ email: e.email.toLowerCase(), label: e.label }))
    .filter((e) => e.email && !existingEmailSet.has(e.email));

  if (newPhones.length > 0) {
    await prisma.phone.createMany({
      data: newPhones.map((p) => ({ contactId, number: p.number, label: p.label })),
      skipDuplicates: true,
    });
  }
  if (newEmails.length > 0) {
    await prisma.contactEmail.createMany({
      data: newEmails.map((e) => ({ contactId, email: e.email, label: e.label })),
      skipDuplicates: true,
    });
  }
}

async function upsertGroup(
  userId: string,
  parsed: VCardContact,
  href: string,
  etag: string,
): Promise<void> {
  const name = parsed.fn?.trim() || "(bez názvu)";
  await prisma.contactGroup.upsert({
    where: { icloudUid: parsed.uid },
    create: {
      userId,
      name,
      memberUids: parsed.groupMemberUids,
      icloudUid: parsed.uid,
      icloudEtag: etag,
      icloudHref: href,
      lastIcloudSyncAt: new Date(),
    },
    update: {
      name,
      memberUids: parsed.groupMemberUids,
      icloudEtag: etag,
      icloudHref: href,
      lastIcloudSyncAt: new Date(),
    },
  });
}

/**
 * Po zpracování všech ContactGroup řádků aktualizujeme denormalizovanou
 * Contact.groups pole — pro UI tabulky stačí seznam jmen skupin.
 */
async function refreshContactGroupsField(userId: string): Promise<void> {
  const groups = await prisma.contactGroup.findMany({ where: { userId } });
  // Map UID → seznam group names
  const uidToGroups = new Map<string, string[]>();
  for (const g of groups) {
    for (const uid of g.memberUids) {
      const arr = uidToGroups.get(uid) ?? [];
      arr.push(g.name);
      uidToGroups.set(uid, arr);
    }
  }
  // Bulk update
  for (const [uid, groupNames] of uidToGroups.entries()) {
    await prisma.contact.updateMany({
      where: { userId, icloudUid: uid },
      data: { groups: Array.from(new Set(groupNames)).sort() },
    });
  }
}

// ============================================================================
// PUSH — DB → iCloud (single contact edit)
// ============================================================================

/**
 * Push single contact zpět na iCloud. Vola se po edit v tabulce.
 * Pokud Contact nemá icloudUid (nový kontakt vytvořený v Rašeliništi),
 * vygeneruje UID a vytvoří vCard na serveru.
 */
export async function pushContactToIcloud(userId: string, contactId: string): Promise<{
  ok: boolean;
  etag?: string;
  error?: string;
}> {
  const creds = await getIcloudCredentials(userId);
  if (!creds) return { ok: false, error: "iCloud credentials nejsou nakonfigurované." };

  // Petr 2026-05-15 (kontakty_brief.md 5.8 F): záloha před každým PUT.
  // Pokud Contact existuje, snapshotneme jeho aktuální stav do ContactBackup
  // → po nepovedeném PUT (412 Conflict, server error) lze obnovit.
  await backupContact(userId, contactId, "before_put").catch((e) => {
    console.warn(`[icloud-push] backup failed for ${contactId}: ${e instanceof Error ? e.message : e}`);
  });

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId },
    include: { phones: true, emails: true },
  });
  if (!contact) return { ok: false, error: "Kontakt nenalezen." };

  // Pro nový kontakt vygeneruj UID
  const uid = contact.icloudUid ?? crypto.randomUUID();
  const addressbookUrl = await getCachedAddressbookUrl(userId);
  if (!addressbookUrl) return { ok: false, error: "Addressbook URL chybí — spusť nejdřív sync." };

  const vcard = buildVCard({
    uid,
    fn: contact.displayName,
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    org: contact.company,
    phones: contact.phones.map((p) => ({ number: p.number, label: p.label })),
    emails: contact.emails.map((e) => ({ email: e.email, label: e.label })),
    addressLines: contact.addressLines,
    birthYear: contact.birthYear,
    birthMonth: contact.birthMonth,
    birthDay: contact.birthDay,
    categories: contact.groups,
    note: contact.note,
    rev: null,
    kind: "individual",
    groupMemberUids: [],
  });

  const url = contact.icloudHref
    ? (contact.icloudHref.startsWith("http") ? contact.icloudHref : new URL(contact.icloudHref, addressbookUrl).toString())
    : `${addressbookUrl.replace(/\/$/, "")}/${uid}.vcf`;

  try {
    const result = await putVCard(url, creds, vcard, contact.icloudEtag);
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        icloudUid: uid,
        icloudEtag: result.etag,
        icloudHref: url,
        lastIcloudSyncAt: new Date(),
        syncSource: contact.syncSource ?? "icloud",
      },
    });
    return { ok: true, etag: result.etag ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
