import { google, type people_v1 } from "googleapis";
import { prisma } from "./db";
import { getAuthorizedClient, recordError, recordUsage } from "./google-oauth";
import { normalizePhone } from "./phone";

/**
 * Google People API sync (read-only).
 * Vlastní kontakty (My Contacts) → upsert do existující tabulky `Contact`.
 *
 * Dedup strategy:
 *   1. Match podle googleResourceName (cycle 2+)
 *   2. Match podle email (case-insensitive)
 *   3. Match podle prvního normalizovaného telefonu
 *   4. Fallback: vytvořit nový kontakt s importedFrom='google'
 */

export interface PeopleSyncResult {
  inserted: number;
  updated: number;
  errors: number;
  durationMs: number;
}

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,photos,organizations,addresses,biographies";

export async function syncGooglePeople(userId: string): Promise<PeopleSyncResult> {
  const start = Date.now();
  const auth = await getAuthorizedClient(userId);
  const people = google.people({ version: "v1", auth });

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  let pageToken: string | undefined = undefined;
  try {
    do {
      const res = await people.people.connections.list({
        resourceName: "people/me",
        personFields: PERSON_FIELDS,
        pageSize: 1000,
        pageToken,
      });
      const items: people_v1.Schema$Person[] = res.data.connections ?? [];
      for (const p of items) {
        try {
          const result = await upsertContact(userId, p);
          if (result === "inserted") inserted++;
          else if (result === "updated") updated++;
        } catch (e) {
          errors++;
          console.error("[google-people] upsert failed for", p.resourceName, e);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    await recordUsage(userId);
  } catch (e) {
    await recordError(userId, e);
    throw e;
  }

  return { inserted, updated, errors, durationMs: Date.now() - start };
}

type UpsertResult = "inserted" | "updated" | "skipped";

async function upsertContact(userId: string, p: people_v1.Schema$Person): Promise<UpsertResult> {
  if (!p.resourceName) return "skipped";

  const primaryName = p.names?.[0];
  const displayName =
    primaryName?.displayName ??
    [primaryName?.givenName, primaryName?.familyName].filter(Boolean).join(" ").trim();
  if (!displayName) return "skipped";

  const firstName = primaryName?.givenName ?? null;
  const lastName = primaryName?.familyName ?? null;

  const emails = (p.emailAddresses ?? [])
    .map((e) => e.value?.toLowerCase().trim())
    .filter((e): e is string => Boolean(e));

  const phonesRaw = (p.phoneNumbers ?? [])
    .map((ph) => ({ raw: ph.value ?? "", label: ph.type ?? null }))
    .filter((ph) => ph.raw);
  const phonesNormalized = phonesRaw
    .map((ph) => ({ number: normalizePhone(ph.raw), label: ph.label }))
    .filter((ph): ph is { number: string; label: string | null } => ph.number !== null);

  const photoUrl = p.photos?.find((ph) => ph.url)?.url ?? null;
  const note = p.biographies?.[0]?.value ?? null;

  // 1) Match podle googleResourceName
  let existing = await prisma.contact.findFirst({
    where: { userId, googleResourceName: p.resourceName },
  });

  // 2) Match podle emailu
  if (!existing && emails.length > 0) {
    existing = await prisma.contact.findFirst({
      where: {
        userId,
        emails: { some: { email: { in: emails, mode: "insensitive" } } },
      },
    });
  }

  // 3) Match podle prvního telefonu
  if (!existing && phonesNormalized.length > 0) {
    existing = await prisma.contact.findFirst({
      where: {
        userId,
        phones: { some: { number: phonesNormalized[0].number } },
      },
    });
  }

  if (!existing) {
    // Insert new
    await prisma.contact.create({
      data: {
        userId,
        displayName,
        firstName,
        lastName,
        note,
        importedFrom: "google",
        googleResourceName: p.resourceName,
        googlePhotoUrl: photoUrl,
        lastGoogleSyncAt: new Date(),
        emails: {
          create: emails.map((email) => ({ email })),
        },
        phones: {
          create: phonesNormalized.map((ph) => ({ number: ph.number, label: ph.label })),
        },
      },
    });
    return "inserted";
  }

  // Update existing — sloučení (ne přepsání).
  // - jméno: zachováme stávající (uživatel mohl upravit)
  // - photo + sync metadata: přepíšeme
  // - emails/phones: přidáme nové (které ještě nemá)
  const existingEmails = await prisma.contactEmail.findMany({
    where: { contactId: existing.id },
    select: { email: true },
  });
  const existingEmSet = new Set(existingEmails.map((e) => e.email.toLowerCase()));
  const newEmails = emails.filter((e) => !existingEmSet.has(e));

  const existingPhones = await prisma.phone.findMany({
    where: { contactId: existing.id },
    select: { number: true },
  });
  const existingPhSet = new Set(existingPhones.map((p) => p.number));
  const newPhones = phonesNormalized.filter((p) => !existingPhSet.has(p.number));

  await prisma.contact.update({
    where: { id: existing.id },
    data: {
      googleResourceName: p.resourceName,
      googlePhotoUrl: photoUrl,
      lastGoogleSyncAt: new Date(),
      // jen pokud kontakt předtím neměl note z jiného zdroje, doplníme
      ...(note && !existing.note ? { note } : {}),
    },
  });

  if (newEmails.length > 0) {
    await prisma.contactEmail.createMany({
      data: newEmails.map((email) => ({ contactId: existing!.id, email })),
      skipDuplicates: true,
    });
  }
  if (newPhones.length > 0) {
    await prisma.phone.createMany({
      data: newPhones.map((ph) => ({ contactId: existing!.id, number: ph.number, label: ph.label })),
      skipDuplicates: true,
    });
  }

  return "updated";
}
