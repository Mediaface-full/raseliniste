/**
 * Google Workspace sync — push z Rašeliniště Contact tabulky do Google.
 *
 * Petr 2026-05-15 (kontakty_brief.md F6).
 *
 * Princip: pro každý Rašeliniště kontakt najdi protějšek v Googlu, pokud
 * existuje → UPDATE, jinak → CREATE. **Nikdy nezakládat duplicity.**
 *
 * 3-úrovňové párování (Google často přepíše UID, tak UID samotné nestačí):
 *   1. UID match (Contact.googleResourceName uložen z předchozího sync)
 *   2. FN + telefony + e-maily match
 *   3. Pouze telefon match (krajní fallback)
 *
 * Cleanup duplicit v Googlu: union-find přes různé kanály (telefon, email,
 * jméno-bez-kontaktů). V každém clusteru zachová ten, jehož resourceName
 * odpovídá Contact.googleResourceName (jinak deterministicky nejmenší).
 *
 * Pull-back: kontakty co existují jen v Googlu (vytvořené přímo tam) →
 * nahraj do iCloudu (jako nové vCardy se zachováním UID).
 */

import { google, type people_v1 } from "googleapis";
import { prisma } from "./db";
import { getAuthorizedClient } from "./google-oauth";

const READ_MASK = "names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies,memberships,metadata,nicknames,relations";
const SLEEP_BETWEEN_REQUESTS_MS = 120; // ~8 req/s, safe pod People API quota

export interface GoogleSyncResult {
  ok: boolean;
  // Push směr (Rašeliniště → Google)
  created: number;     // nové v Googlu
  updated: number;     // update v Googlu
  // Pull směr (Google → Rašeliniště)
  pulledCreated: number;  // nové v naší DB z Googlu
  pulledUpdated: number;  // update v naší DB z Googlu
  skipped: number;
  errors: number;
  durationMs: number;
  error?: string;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function getPeopleClient(userId: string): Promise<people_v1.People> {
  const oauth = await getAuthorizedClient(userId);
  return google.people({ version: "v1", auth: oauth });
}

// ============================================================================
// 3-úrovňové párování
// ============================================================================

interface GoogleConnection {
  resourceName: string;
  etag: string;
  fn: string;
  phones: string[];        // posledních 9 číslic per phone
  emails: string[];        // lowercase
  /** Google updateTime (RFC 3339) z primary source v metadata.sources[] — pro last-write-wins */
  updateTime: Date | null;
  raw: people_v1.Schema$Person;
}

function phoneKey(num: string): string {
  return num.replace(/\D/g, "").slice(-9);
}

async function fetchAllGoogleConnections(userId: string): Promise<GoogleConnection[]> {
  const people = await getPeopleClient(userId);
  const out: GoogleConnection[] = [];
  let pageToken: string | undefined;
  do {
    const res = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000,
      personFields: READ_MASK,
      pageToken,
    });
    for (const c of res.data.connections ?? []) {
      if (!c.resourceName) continue;
      const fn = c.names?.[0]?.displayName ?? "";
      // updateTime z primary source (CONTACT type) — pro last-write-wins
      const primarySource = (c.metadata?.sources ?? []).find((s) => s.type === "CONTACT");
      const updateTime = primarySource?.updateTime ? new Date(primarySource.updateTime) : null;
      out.push({
        resourceName: c.resourceName,
        etag: c.etag ?? "",
        fn,
        phones: (c.phoneNumbers ?? []).map((p) => phoneKey(p.value ?? "")).filter(Boolean),
        emails: (c.emailAddresses ?? []).map((e) => (e.value ?? "").toLowerCase().trim()).filter(Boolean),
        updateTime,
        raw: c,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
    if (pageToken) await sleep(SLEEP_BETWEEN_REQUESTS_MS);
  } while (pageToken);
  return out;
}

function findGoogleMatch(
  contact: Awaited<ReturnType<typeof prisma.contact.findFirst>> & {
    phones: { number: string }[];
    emails: { email: string }[];
  },
  googleConnections: GoogleConnection[],
): GoogleConnection | null {
  // Level 1: googleResourceName uložen z minulé sync
  if (contact.googleResourceName) {
    const m = googleConnections.find((g) => g.resourceName === contact.googleResourceName);
    if (m) return m;
  }

  const contactFn = contact.displayName.toLowerCase().trim();
  const contactPhones = contact.phones.map((p) => phoneKey(p.number)).filter(Boolean);
  const contactEmails = contact.emails.map((e) => e.email.toLowerCase().trim()).filter(Boolean);

  // Level 2: FN + (telefon NEBO email) match
  for (const g of googleConnections) {
    if (g.fn.toLowerCase().trim() !== contactFn) continue;
    const phoneOverlap = contactPhones.some((p) => g.phones.includes(p));
    const emailOverlap = contactEmails.some((e) => g.emails.includes(e));
    if (phoneOverlap || emailOverlap) return g;
  }

  // Level 3: jen telefon match (krajní)
  for (const g of googleConnections) {
    for (const p of contactPhones) {
      if (g.phones.includes(p)) return g;
    }
  }

  return null;
}

// ============================================================================
// PUSH — iCloud Contact → Google
// ============================================================================

function buildPersonFromContact(
  c: Awaited<ReturnType<typeof prisma.contact.findFirst>> & {
    phones: { number: string; label: string | null }[];
    emails: { email: string; label: string | null }[];
  },
): people_v1.Schema$Person {
  const person: people_v1.Schema$Person = {};
  if (c.firstName || c.lastName) {
    person.names = [{
      givenName: c.firstName ?? "",
      familyName: c.lastName ?? "",
      displayName: c.displayName,
    }];
  } else if (c.displayName) {
    person.names = [{ displayName: c.displayName, unstructuredName: c.displayName }];
  }
  if (c.phones.length > 0) {
    person.phoneNumbers = c.phones.map((p) => ({
      value: p.number,
      type: p.label ?? undefined,
    }));
  }
  if (c.emails.length > 0) {
    person.emailAddresses = c.emails.map((e) => ({
      value: e.email,
      type: e.label ?? undefined,
    }));
  }
  if (c.company) {
    person.organizations = [{ name: c.company }];
  }
  if (c.addressLines.length > 0) {
    person.addresses = c.addressLines.map((line) => ({
      formattedValue: line,
      type: "home",
    }));
  }
  if (c.birthMonth && c.birthDay) {
    person.birthdays = [{
      date: {
        ...(c.birthYear ? { year: c.birthYear } : {}),
        month: c.birthMonth,
        day: c.birthDay,
      },
    }];
  }
  if (c.note) {
    person.biographies = [{ value: c.note, contentType: "TEXT_PLAIN" }];
  }
  return person;
}

const PERSON_UPDATE_FIELDS = "names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies";

export async function syncIcloudToGoogle(
  userId: string,
  options: { scope?: "all" | { company: string } | { group: string } } = {},
): Promise<GoogleSyncResult> {
  const start = Date.now();
  const stats: GoogleSyncResult = { ok: false, created: 0, updated: 0, pulledCreated: 0, pulledUpdated: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    // 1) Načti všechny Rašeliniště kontakty (s filtrem scope)
    let where: Parameters<typeof prisma.contact.findMany>[0]["where"] = { userId };
    if (typeof options.scope === "object" && "company" in options.scope) {
      where = { ...where, company: options.scope.company };
    } else if (typeof options.scope === "object" && "group" in options.scope) {
      where = { ...where, groups: { has: options.scope.group } };
    }
    const contacts = await prisma.contact.findMany({
      where,
      include: { phones: true, emails: true },
    });

    // 2) Stáhnout existující Google kontakty
    const googleConnections = await fetchAllGoogleConnections(userId);

    // 3) Pro každý Rašeliniště kontakt — najít match nebo create
    const people = await getPeopleClient(userId);

    for (const c of contacts) {
      try {
        const match = findGoogleMatch(c, googleConnections);
        const person = buildPersonFromContact(c);

        if (match) {
          // UPDATE
          await people.people.updateContact({
            resourceName: match.resourceName,
            updatePersonFields: PERSON_UPDATE_FIELDS,
            requestBody: { ...person, etag: match.etag },
          });
          if (!c.googleResourceName || c.googleResourceName !== match.resourceName) {
            await prisma.contact.update({
              where: { id: c.id },
              data: { googleResourceName: match.resourceName, lastGoogleSyncAt: new Date() },
            });
          } else {
            await prisma.contact.update({
              where: { id: c.id },
              data: { lastGoogleSyncAt: new Date() },
            });
          }
          stats.updated++;
        } else {
          // CREATE
          const res = await people.people.createContact({ requestBody: person });
          const newResourceName = res.data.resourceName;
          if (newResourceName) {
            await prisma.contact.update({
              where: { id: c.id },
              data: { googleResourceName: newResourceName, lastGoogleSyncAt: new Date() },
            });
          }
          stats.created++;
        }
        await sleep(SLEEP_BETWEEN_REQUESTS_MS);
      } catch (e) {
        console.warn(`[google-sync] contact ${c.id} (${c.displayName}) err:`, e instanceof Error ? e.message : e);
        stats.errors++;
      }
    }

    stats.ok = true;
  } catch (e) {
    stats.error = e instanceof Error ? e.message : String(e);
  }

  stats.durationMs = Date.now() - start;
  console.log(`[google-sync] userId=${userId} created=${stats.created} updated=${stats.updated} errors=${stats.errors} duration=${stats.durationMs}ms`);
  return stats;
}

// ============================================================================
// OBOUSMĚRNÝ SYNC (Petr 2026-05-15)
// ============================================================================
//
// Last-write-wins podle Google updateTime vs Contact.lastGoogleSyncAt /
// Contact.updatedAt.
//
// Algoritmus:
//   1. Stáhni všechny Google connections (s metadata.sources[].updateTime)
//   2. Stáhni všechny naše Contacts
//   3. Pro každý Google kontakt:
//        a) Najdi match v naší DB (3-úrovňové parování)
//        b) Pokud match a Google.updateTime > Contact.lastGoogleSyncAt:
//             → pull do DB (jen core fields, overlay zachován)
//        c) Pokud žádný match (kontakt jen v Google):
//             → create v naší DB s syncSource="google"
//   4. Pro každý náš Contact:
//        a) Pokud googleResourceName == null:
//             → create v Google + uložit resourceName
//        b) Pokud Contact.updatedAt > lastGoogleSyncAt (změna od posledního sync):
//             → update v Google
//        c) Jinak skip
//
// Overlay model: pull z Google NEPŘEPISUJE isVip/aliases/clientTag/...

import { backupContact } from "./contacts-backup";
import { startSyncProgress, updateSyncProgress, finishSyncProgress } from "./contacts-sync-progress";

/**
 * Parse Google Person → core fields pro Contact upsert (overlay-safe).
 */
function googlePersonToCore(p: people_v1.Schema$Person): {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  addressLines: string[];
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  note: string | null;
  phones: { number: string; label: string | null }[];
  emails: { email: string; label: string | null }[];
} {
  const name = p.names?.[0];
  return {
    displayName: name?.displayName ?? name?.unstructuredName ?? "(bez jména)",
    firstName: name?.givenName ?? null,
    lastName: name?.familyName ?? null,
    company: p.organizations?.[0]?.name ?? null,
    addressLines: (p.addresses ?? []).map((a) => a.formattedValue ?? "").filter(Boolean),
    birthYear: p.birthdays?.[0]?.date?.year ?? null,
    birthMonth: p.birthdays?.[0]?.date?.month ?? null,
    birthDay: p.birthdays?.[0]?.date?.day ?? null,
    note: p.biographies?.[0]?.value ?? null,
    phones: (p.phoneNumbers ?? []).map((ph) => ({ number: ph.value ?? "", label: ph.type ?? null })).filter((x) => x.number),
    emails: (p.emailAddresses ?? []).map((e) => ({ email: (e.value ?? "").toLowerCase(), label: e.type ?? null })).filter((x) => x.email),
  };
}

export async function syncWithGoogle(
  userId: string,
  options: { scope?: "all" | { company: string } | { group: string } } = {},
): Promise<GoogleSyncResult> {
  const start = Date.now();
  const stats: GoogleSyncResult = { ok: false, created: 0, updated: 0, pulledCreated: 0, pulledUpdated: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    await startSyncProgress(userId, "google");
    // 1) Načti naše kontakty (scope filter)
    let where: Parameters<typeof prisma.contact.findMany>[0]["where"] = { userId };
    if (typeof options.scope === "object" && "company" in options.scope) {
      where = { ...where, company: options.scope.company };
    } else if (typeof options.scope === "object" && "group" in options.scope) {
      where = { ...where, groups: { has: options.scope.group } };
    }
    const ourContacts = await prisma.contact.findMany({
      where,
      include: { phones: true, emails: true },
    });
    await updateSyncProgress(userId, {
      stage: "fetching",
      total: ourContacts.length,
      message: `Stahuji Google connections (DB má ${ourContacts.length} kontaktů)…`,
    });

    // 2) Stáhni Google connections
    const googleConnections = await fetchAllGoogleConnections(userId);
    const people = await getPeopleClient(userId);

    // 3) Build match indexy pro pull (Google → DB)
    const matchedResourceNames = new Set<string>();

    // PULL: pro každý Google kontakt — pokud match s naším → update (pokud novější),
    // jinak create v DB
    for (const g of googleConnections) {
      try {
        // Pseudo-Contact pro findGoogleMatch
        const matched = ourContacts.find((c) => {
          if (c.googleResourceName === g.resourceName) return true;
          const cFn = c.displayName.toLowerCase().trim();
          if (cFn === g.fn.toLowerCase().trim()) {
            const cPhones = c.phones.map((p) => phoneKey(p.number));
            const cEmails = c.emails.map((e) => e.email.toLowerCase().trim());
            if (cPhones.some((p) => g.phones.includes(p)) || cEmails.some((e) => g.emails.includes(e))) {
              return true;
            }
          }
          // L3 fallback: jen telefon match
          const cPhones2 = c.phones.map((p) => phoneKey(p.number));
          if (cPhones2.some((p) => g.phones.includes(p))) return true;
          return false;
        });

        if (matched) {
          matchedResourceNames.add(g.resourceName);
          // Last-write-wins: Google novější než lastGoogleSyncAt → pull
          const dbLastSync = matched.lastGoogleSyncAt;
          const googleUpdated = g.updateTime;
          if (googleUpdated && (!dbLastSync || googleUpdated > dbLastSync)) {
            // Zálohuj naši verzi před přepsáním (overlay je zachován v DB, ale core jdou pryč)
            await backupContact(userId, matched.id, "before_put").catch(() => null);
            const core = googlePersonToCore(g.raw);
            await prisma.contact.update({
              where: { id: matched.id },
              data: {
                displayName: core.displayName,
                firstName: core.firstName,
                lastName: core.lastName,
                company: core.company,
                addressLines: core.addressLines,
                birthYear: core.birthYear,
                birthMonth: core.birthMonth,
                birthDay: core.birthDay,
                note: core.note ?? matched.note, // note keep pokud Google nemá
                googleResourceName: g.resourceName,
                lastGoogleSyncAt: new Date(),
              },
            });
            // Reset phones/emails na Google verzi
            await prisma.phone.deleteMany({ where: { contactId: matched.id } });
            await prisma.contactEmail.deleteMany({ where: { contactId: matched.id } });
            for (const p of core.phones) {
              await prisma.phone.create({ data: { contactId: matched.id, number: p.number, label: p.label } }).catch(() => null);
            }
            for (const e of core.emails) {
              await prisma.contactEmail.create({ data: { contactId: matched.id, email: e.email, label: e.label } }).catch(() => null);
            }
            stats.pulledUpdated++;
          }
        } else {
          // Kontakt jen v Google — vytvořit v DB
          const core = googlePersonToCore(g.raw);
          const created = await prisma.contact.create({
            data: {
              userId,
              displayName: core.displayName,
              firstName: core.firstName,
              lastName: core.lastName,
              company: core.company,
              addressLines: core.addressLines,
              birthYear: core.birthYear,
              birthMonth: core.birthMonth,
              birthDay: core.birthDay,
              note: core.note,
              googleResourceName: g.resourceName,
              lastGoogleSyncAt: new Date(),
              syncSource: "google",
              importedFrom: "google",
            },
          });
          for (const p of core.phones) {
            await prisma.phone.create({ data: { contactId: created.id, number: p.number, label: p.label } }).catch(() => null);
          }
          for (const e of core.emails) {
            await prisma.contactEmail.create({ data: { contactId: created.id, email: e.email, label: e.label } }).catch(() => null);
          }
          stats.pulledCreated++;
        }
      } catch (e) {
        console.warn(`[google-sync-pull] resourceName=${g.resourceName} err:`, e instanceof Error ? e.message : e);
        stats.errors++;
      }
      await sleep(SLEEP_BETWEEN_REQUESTS_MS);
    }

    // PUSH: pro každý náš Contact — pokud změna od posledního sync nebo nový, push do Google
    // Refresh ourContacts po pull (mohli jsme přidat nové)
    const ourContactsFresh = await prisma.contact.findMany({
      where,
      include: { phones: true, emails: true },
    });

    for (const c of ourContactsFresh) {
      try {
        const isNewToGoogle = !c.googleResourceName;
        const hasLocalChanges = c.lastGoogleSyncAt ? c.updatedAt > c.lastGoogleSyncAt : true;
        // Skip pokud nic nového od posledního push a má resourceName
        if (!isNewToGoogle && !hasLocalChanges) {
          stats.skipped++;
          continue;
        }

        const person = buildPersonFromContact(c);

        if (isNewToGoogle) {
          const res = await people.people.createContact({ requestBody: person });
          if (res.data.resourceName) {
            await prisma.contact.update({
              where: { id: c.id },
              data: { googleResourceName: res.data.resourceName, lastGoogleSyncAt: new Date() },
            });
          }
          stats.created++;
        } else {
          // Update — vyžaduje etag, najdi v google connections cache
          const g = googleConnections.find((gc) => gc.resourceName === c.googleResourceName);
          if (!g) {
            // Google ho mezitím smazal? Vytvořit znovu.
            const res = await people.people.createContact({ requestBody: person });
            if (res.data.resourceName) {
              await prisma.contact.update({
                where: { id: c.id },
                data: { googleResourceName: res.data.resourceName, lastGoogleSyncAt: new Date() },
              });
            }
            stats.created++;
          } else {
            await people.people.updateContact({
              resourceName: g.resourceName,
              updatePersonFields: PERSON_UPDATE_FIELDS,
              requestBody: { ...person, etag: g.etag },
            });
            await prisma.contact.update({
              where: { id: c.id },
              data: { lastGoogleSyncAt: new Date() },
            });
            stats.updated++;
          }
        }
        await sleep(SLEEP_BETWEEN_REQUESTS_MS);
      } catch (e) {
        console.warn(`[google-sync-push] contact ${c.id} (${c.displayName}) err:`, e instanceof Error ? e.message : e);
        stats.errors++;
      }
    }

    stats.ok = true;
    await finishSyncProgress(userId, "done", {
      message: `Hotovo. Z Google: ${stats.pulledCreated} nových + ${stats.pulledUpdated} update. Do Google: ${stats.created} nových + ${stats.updated} update. Skipped ${stats.skipped}.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stats.error = msg;
    await finishSyncProgress(userId, "error", { error: msg.slice(0, 200) });
  }

  stats.durationMs = Date.now() - start;
  console.log(`[google-sync-bidirectional] userId=${userId} push(created=${stats.created} updated=${stats.updated}) pull(created=${stats.pulledCreated} updated=${stats.pulledUpdated}) skipped=${stats.skipped} errors=${stats.errors} duration=${stats.durationMs}ms`);
  return stats;
}

// ============================================================================
// CLEANUP duplicit v Googlu (union-find)
// ============================================================================

export interface GoogleDuplicateCluster {
  members: GoogleConnection[];
  keep: GoogleConnection; // ten zachováme (preferenčně match s Contact.googleResourceName)
}

export async function findGoogleDuplicates(userId: string): Promise<GoogleDuplicateCluster[]> {
  const connections = await fetchAllGoogleConnections(userId);
  const ourResourceNames = new Set(
    (await prisma.contact.findMany({
      where: { userId, googleResourceName: { not: null } },
      select: { googleResourceName: true },
    })).map((c) => c.googleResourceName!).filter(Boolean),
  );

  // Union-find
  const parent = connections.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byPhone = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  const byName = new Map<string, number[]>();

  connections.forEach((c, i) => {
    if (c.fn) {
      const k = c.fn.toLowerCase().trim();
      (byName.get(k) ?? byName.set(k, []).get(k)!).push(i);
    }
    for (const p of c.phones) {
      (byPhone.get(p) ?? byPhone.set(p, []).get(p)!).push(i);
    }
    for (const e of c.emails) {
      (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(i);
    }
  });

  for (const idxs of [...byName.values(), ...byPhone.values(), ...byEmail.values()]) {
    if (idxs.length < 2) continue;
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  }

  // Group
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < connections.length; i++) {
    const r = find(i);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(i);
  }

  const out: GoogleDuplicateCluster[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const conns = members.map((i) => connections[i]);
    // Keep preference: match s naším Contact.googleResourceName
    let keep = conns.find((c) => ourResourceNames.has(c.resourceName));
    if (!keep) keep = conns.sort((a, b) => a.resourceName.localeCompare(b.resourceName))[0];
    out.push({ members: conns, keep });
  }
  return out;
}

export async function cleanupGoogleDuplicates(userId: string): Promise<{
  ok: boolean;
  deleted: number;
  clustersProcessed: number;
  errors: number;
  errorMessages: string[];
}> {
  const clusters = await findGoogleDuplicates(userId);
  const people = await getPeopleClient(userId);
  let deleted = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  for (const cluster of clusters) {
    for (const m of cluster.members) {
      if (m.resourceName === cluster.keep.resourceName) continue;
      try {
        await people.people.deleteContact({ resourceName: m.resourceName });
        deleted++;
        await sleep(SLEEP_BETWEEN_REQUESTS_MS);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[google-cleanup] delete ${m.resourceName} err:`, msg);
        errors++;
        // Sběr unikátních chyb (typicky 1 příčina pro všechny — scope/auth)
        const shortMsg = msg.slice(0, 200);
        if (!errorMessages.includes(shortMsg) && errorMessages.length < 3) {
          errorMessages.push(shortMsg);
        }
      }
    }
  }
  return { ok: true, deleted, clustersProcessed: clusters.length, errors, errorMessages };
}

// ============================================================================
// PULL-BACK — kontakty co existují jen v Googlu → DB (+ iCloud později ručně)
// ============================================================================

export interface PullBackCandidate {
  resourceName: string;
  fn: string;
  phones: string[];
  emails: string[];
}

export async function findPullBackCandidates(userId: string): Promise<PullBackCandidate[]> {
  const googleConnections = await fetchAllGoogleConnections(userId);
  const ourContacts = await prisma.contact.findMany({
    where: { userId },
    include: { phones: true, emails: true },
  });

  // Build matching indexy
  const ourPhones = new Set<string>();
  const ourEmails = new Set<string>();
  const ourResourceNames = new Set<string>();
  for (const c of ourContacts) {
    if (c.googleResourceName) ourResourceNames.add(c.googleResourceName);
    for (const p of c.phones) {
      const k = phoneKey(p.number);
      if (k) ourPhones.add(k);
    }
    for (const e of c.emails) ourEmails.add(e.email.toLowerCase());
  }

  const candidates: PullBackCandidate[] = [];
  for (const g of googleConnections) {
    // Skip pokud je už náš
    if (ourResourceNames.has(g.resourceName)) continue;
    if (g.phones.some((p) => ourPhones.has(p))) continue;
    if (g.emails.some((e) => ourEmails.has(e))) continue;
    if (!g.fn) continue;
    candidates.push({
      resourceName: g.resourceName,
      fn: g.fn,
      phones: g.phones,
      emails: g.emails,
    });
  }
  return candidates;
}

export async function pullBackFromGoogle(
  userId: string,
  resourceNames: string[],
): Promise<{ ok: boolean; created: number; errors: number }> {
  if (resourceNames.length === 0) return { ok: true, created: 0, errors: 0 };

  const people = await getPeopleClient(userId);
  let created = 0;
  let errors = 0;

  for (const rn of resourceNames) {
    try {
      const res = await people.people.get({ resourceName: rn, personFields: READ_MASK });
      const p = res.data;
      const name = p.names?.[0]?.displayName ?? p.names?.[0]?.unstructuredName ?? "(bez jména)";
      await prisma.contact.create({
        data: {
          userId,
          displayName: name,
          firstName: p.names?.[0]?.givenName ?? null,
          lastName: p.names?.[0]?.familyName ?? null,
          company: p.organizations?.[0]?.name ?? null,
          addressLines: (p.addresses ?? []).map((a) => a.formattedValue ?? "").filter(Boolean),
          birthYear: p.birthdays?.[0]?.date?.year ?? null,
          birthMonth: p.birthdays?.[0]?.date?.month ?? null,
          birthDay: p.birthdays?.[0]?.date?.day ?? null,
          note: p.biographies?.[0]?.value ?? null,
          googleResourceName: rn,
          lastGoogleSyncAt: new Date(),
          syncSource: "google",
          importedFrom: "google",
          phones: {
            create: (p.phoneNumbers ?? []).map((ph) => ({
              number: ph.value ?? "",
              label: ph.type ?? null,
            })).filter((x) => x.number),
          },
          emails: {
            create: (p.emailAddresses ?? []).map((e) => ({
              email: (e.value ?? "").toLowerCase(),
              label: e.type ?? null,
            })).filter((x) => x.email),
          },
        },
      });
      created++;
      await sleep(SLEEP_BETWEEN_REQUESTS_MS);
    } catch (e) {
      console.warn(`[google-pullback] ${rn} err:`, e instanceof Error ? e.message : e);
      errors++;
    }
  }
  return { ok: true, created, errors };
}
