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

const READ_MASK = "names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies,memberships,metadata";
const SLEEP_BETWEEN_REQUESTS_MS = 120; // ~8 req/s, safe pod People API quota

export interface GoogleSyncResult {
  ok: boolean;
  created: number;
  updated: number;
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
      out.push({
        resourceName: c.resourceName,
        etag: c.etag ?? "",
        fn,
        phones: (c.phoneNumbers ?? []).map((p) => phoneKey(p.value ?? "")).filter(Boolean),
        emails: (c.emailAddresses ?? []).map((e) => (e.value ?? "").toLowerCase().trim()).filter(Boolean),
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
  const stats: GoogleSyncResult = { ok: false, created: 0, updated: 0, skipped: 0, errors: 0, durationMs: 0 };

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
}> {
  const clusters = await findGoogleDuplicates(userId);
  const people = await getPeopleClient(userId);
  let deleted = 0;
  let errors = 0;
  for (const cluster of clusters) {
    for (const m of cluster.members) {
      if (m.resourceName === cluster.keep.resourceName) continue;
      try {
        await people.people.deleteContact({ resourceName: m.resourceName });
        deleted++;
        await sleep(SLEEP_BETWEEN_REQUESTS_MS);
      } catch (e) {
        console.warn(`[google-cleanup] delete ${m.resourceName} err:`, e instanceof Error ? e.message : e);
        errors++;
      }
    }
  }
  return { ok: true, deleted, clustersProcessed: clusters.length, errors };
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
