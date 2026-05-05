/* eslint-disable @typescript-eslint/no-explicit-any */
import { DAVClient } from "tsdav";
import ICAL from "ical.js";
import { prisma } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { classifyEvent, type EventTypeStr } from "./event-classifier";

/**
 * iCloud CalDAV sync (read-only).
 *
 * Setup model:
 *   - Jeden Apple ID + app-specific password (vygenerované na appleid.apple.com).
 *   - Uloženo v `UserIntegration(provider="icloud")` — heslo šifrované AES-256-GCM,
 *     `config` JSON drží Apple ID + výběr 2 kalendářů (synův + partnerčin).
 *   - Brief počítá se dvěma sdílenými kalendáři: ICLOUD_SON (syn = hokej),
 *     ICLOUD_PARTNER (partnerka = NOCNI/DENNI šichty + ostatní).
 *
 * Sync je výlučně read-only. Žádné `createCalendarObject` / `updateCalendarObject`
 * volání. CalDAV server: https://caldav.icloud.com (Apple).
 */

const ICLOUD_SERVER = "https://caldav.icloud.com";
const SYNC_WINDOW_PAST_DAYS = 7;
const SYNC_WINDOW_FUTURE_DAYS = 60;

export type IcloudSourceTag = "ICLOUD_SON" | "ICLOUD_PARTNER";

export interface IcloudConfig {
  appleId: string;
  sonCalendarUrl?: string;
  sonCalendarName?: string;
  partnerCalendarUrl?: string;
  partnerCalendarName?: string;
  connectedAt?: string;
}

export interface IcloudCalendarInfo {
  url: string;
  displayName: string;
  ctag: string | null;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Credentials — uložení / načtení
// ---------------------------------------------------------------------------

export async function saveCredentials(
  userId: string,
  appleId: string,
  appPassword: string,
): Promise<void> {
  const { enc, iv, tag } = encryptSecret(appPassword);

  const existing = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
    select: { config: true },
  });
  const prevConfig = ((existing?.config as unknown) ?? {}) as IcloudConfig;

  await prisma.userIntegration.upsert({
    where: { userId_provider: { userId, provider: "icloud" } },
    create: {
      userId,
      provider: "icloud",
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: { ...prevConfig, appleId, connectedAt: new Date().toISOString() },
      lastUsedAt: new Date(),
    },
    update: {
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: { ...prevConfig, appleId, connectedAt: new Date().toISOString() },
      lastError: null,
      lastUsedAt: new Date(),
    },
  });
}

export async function selectCalendars(
  userId: string,
  selection: {
    sonCalendarUrl?: string;
    sonCalendarName?: string;
    partnerCalendarUrl?: string;
    partnerCalendarName?: string;
  },
): Promise<void> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
    select: { config: true },
  });
  if (!integration) {
    throw new Error("iCloud není připojený. Nejprve zadej Apple ID a app password.");
  }
  const config = (integration.config as unknown ?? {}) as IcloudConfig;
  await prisma.userIntegration.update({
    where: { userId_provider: { userId, provider: "icloud" } },
    data: {
      config: {
        ...config,
        ...selection,
      },
    },
  });
}

export async function disconnect(userId: string): Promise<void> {
  await prisma.userIntegration.deleteMany({
    where: { userId, provider: "icloud" },
  });
  // Ponecháme historické CalendarEvent v DB (kontext zůstává viditelný),
  // ale označíme je jako odpojené, aby nepřekážely při znovupřipojení.
  await prisma.calendarEvent.updateMany({
    where: { source: { in: ["ICLOUD_SON", "ICLOUD_PARTNER"] } },
    data: { deletedRemotely: true },
  });
}

export async function getStatus(userId: string): Promise<{
  connected: boolean;
  appleId: string | null;
  sonCalendarName: string | null;
  partnerCalendarName: string | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  stats: { sonEvents: number; partnerEvents: number };
}> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
    select: { config: true, lastUsedAt: true, lastError: true },
  });

  const sonEvents = await prisma.calendarEvent.count({
    where: { source: "ICLOUD_SON", deletedRemotely: false },
  });
  const partnerEvents = await prisma.calendarEvent.count({
    where: { source: "ICLOUD_PARTNER", deletedRemotely: false },
  });

  if (!integration) {
    return {
      connected: false,
      appleId: null,
      sonCalendarName: null,
      partnerCalendarName: null,
      lastUsedAt: null,
      lastError: null,
      stats: { sonEvents, partnerEvents },
    };
  }
  const config = (integration.config as unknown ?? {}) as IcloudConfig;
  return {
    connected: true,
    appleId: config.appleId ?? null,
    sonCalendarName: config.sonCalendarName ?? null,
    partnerCalendarName: config.partnerCalendarName ?? null,
    lastUsedAt: integration.lastUsedAt,
    lastError: integration.lastError,
    stats: { sonEvents, partnerEvents },
  };
}

async function loadClient(userId: string): Promise<{
  client: DAVClient;
  config: IcloudConfig;
}> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: "icloud" } },
  });
  if (!integration) {
    throw new Error("iCloud není připojený.");
  }
  const password = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
  const config = (integration.config as unknown ?? {}) as IcloudConfig;
  if (!config.appleId) {
    throw new Error("Chybí Apple ID v iCloud konfiguraci.");
  }
  const client = new DAVClient({
    serverUrl: ICLOUD_SERVER,
    credentials: { username: config.appleId, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  await client.login();
  return { client, config };
}

// ---------------------------------------------------------------------------
// Discovery: vrací seznam všech dostupných kalendářů (vlastní + sdílené)
// ---------------------------------------------------------------------------

export async function listCalendars(userId: string): Promise<IcloudCalendarInfo[]> {
  const { client } = await loadClient(userId);
  const calendars = await client.fetchCalendars();
  return calendars.map((c: any) => ({
    url: c.url,
    displayName:
      typeof c.displayName === "string"
        ? c.displayName
        : c.displayName?._cdata ?? c.displayName?.["#text"] ?? "(bez názvu)",
    ctag: typeof c.ctag === "string" ? c.ctag : null,
  }));
}

// ---------------------------------------------------------------------------
// Sync — read-only iCal events do CalendarEvent tabulky
// ---------------------------------------------------------------------------

export async function syncIcloud(
  userId: string,
  sourceTag: IcloudSourceTag,
): Promise<SyncResult> {
  const start = Date.now();
  const { client, config } = await loadClient(userId);

  const calendarUrl =
    sourceTag === "ICLOUD_SON" ? config.sonCalendarUrl : config.partnerCalendarUrl;
  if (!calendarUrl) {
    throw new Error(
      `${sourceTag === "ICLOUD_SON" ? "Synův" : "Partnerčin"} kalendář není vybraný.`,
    );
  }

  const calendars = await client.fetchCalendars();
  const calendar = calendars.find((c: any) => c.url === calendarUrl);
  if (!calendar) {
    throw new Error(`Kalendář (${calendarUrl}) už není dostupný — možná byl odsdílený.`);
  }

  const now = new Date();
  const timeMin = new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let errors = 0;

  try {
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start: timeMin.toISOString(),
        end: timeMax.toISOString(),
      },
      expand: true,
    });

    // Sledujeme, které externalIds jsme v tomto syncu viděli — co chybí, je smazané.
    const seenIds = new Set<string>();

    for (const obj of objects) {
      try {
        const result = await upsertFromIcs(obj.data ?? "", obj.url, sourceTag, seenIds, timeMin, timeMax);
        inserted += result.inserted;
        updated += result.updated;
      } catch (e) {
        errors++;
        console.error("[icloud] upsert failed for", obj.url, e);
      }
    }

    // Mark missing as deleted within window
    const deletedRows = await prisma.calendarEvent.updateMany({
      where: {
        source: sourceTag,
        deletedRemotely: false,
        externalId: { notIn: Array.from(seenIds) },
        startsAt: { gte: timeMin, lte: timeMax },
      },
      data: { deletedRemotely: true, lastSyncedAt: new Date() },
    });
    deleted = deletedRows.count;

    await prisma.userIntegration.updateMany({
      where: { userId, provider: "icloud" },
      data: { lastUsedAt: new Date(), lastError: null },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.userIntegration.updateMany({
      where: { userId, provider: "icloud" },
      data: { lastError: msg.slice(0, 1000) },
    });
    throw e;
  }

  return { inserted, updated, deleted, errors, durationMs: Date.now() - start };
}

export async function syncBothIcloud(userId: string): Promise<{
  son: SyncResult | null;
  partner: SyncResult | null;
  errors: string[];
}> {
  const status = await getStatus(userId);
  const errors: string[] = [];
  let son: SyncResult | null = null;
  let partner: SyncResult | null = null;

  if (status.sonCalendarName) {
    try {
      son = await syncIcloud(userId, "ICLOUD_SON");
    } catch (e) {
      errors.push(`Syn: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (status.partnerCalendarName) {
    try {
      partner = await syncIcloud(userId, "ICLOUD_PARTNER");
    } catch (e) {
      errors.push(`Partnerka: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { son, partner, errors };
}

// ---------------------------------------------------------------------------
// iCal parsing — přes ical.js. Jeden VCALENDAR může obsahovat 1+ VEVENT
// (recurring + exceptions). Recurring instance generujeme přes `expand=true`
// už na CalDAV vrstvě, takže typicky každý objekt = 1 VEVENT.
// ---------------------------------------------------------------------------

async function upsertFromIcs(
  icsText: string,
  objectUrl: string,
  sourceTag: IcloudSourceTag,
  seenIds: Set<string>,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ inserted: number; updated: number }> {
  if (!icsText.trim()) return { inserted: 0, updated: 0 };

  let parsed: any;
  try {
    parsed = ICAL.parse(icsText);
  } catch (e) {
    console.warn("[icloud] failed to parse ICS:", e);
    return { inserted: 0, updated: 0 };
  }

  const comp = new ICAL.Component(parsed);
  const vevents = comp.getAllSubcomponents("vevent");
  let inserted = 0;
  let updated = 0;

  for (const ve of vevents) {
    const event = new ICAL.Event(ve);

    const uid = event.uid;
    if (!uid) continue;

    const startsAtRaw = event.startDate?.toJSDate();
    const endsAtRaw = event.endDate?.toJSDate();
    if (!startsAtRaw || !endsAtRaw) continue;

    // Recurring: pokud nemá explicitní expansion (expand=true neudělalo svoji práci),
    // expanduj ručně iterátorem v rozsahu okna.
    //
    // BUG FIX 2026-05-05: iterator startuje od DTSTART (kdy event vznikl). Pro
    // daily/weekly event existující od 2020 původní safety<366 vyčerpal limit
    // dávno před dnešním sync oknem — recurring eventy mizely. Fix:
    //  1) jump-forward iterator na začátek okna (event.iterator(startTime))
    //     — pokud DTSTART je před oknem
    //  2) zvýšit safety limit na 2000 (pokrývá daily přes 5+ let pokud by
    //     jump-forward selhal a iterator by musel projít vše)
    const isRecurring = event.isRecurring();
    if (isRecurring) {
      // Jump-forward na windowStart pokud DTSTART je dávno před oknem.
      // Některé RRULE konfigurace jump-forward neřeknou (ICAL.js fallback) —
      // pak vyšší safety limit dotáhne zbytek.
      let iter: any;
      try {
        if (startsAtRaw < windowStart) {
          const fromIcal = ICAL.Time.fromJSDate(windowStart, false);
          iter = event.iterator(fromIcal);
        } else {
          iter = event.iterator();
        }
      } catch {
        iter = event.iterator();
      }
      let next: any;
      let safety = 0;
      while ((next = iter.next()) && safety < 2000) {
        safety++;
        const occStart = next.toJSDate();
        if (occStart > windowEnd) break;
        const occEnd = new Date(occStart.getTime() + (endsAtRaw.getTime() - startsAtRaw.getTime()));
        if (occEnd < windowStart) continue;
        const externalId = `${uid}_${occStart.toISOString()}`;
        const r = await upsertOne(event, externalId, occStart, occEnd, sourceTag, objectUrl);
        seenIds.add(externalId);
        if (r === "inserted") inserted++;
        else if (r === "updated") updated++;
      }
    } else {
      const externalId = uid;
      const r = await upsertOne(event, externalId, startsAtRaw, endsAtRaw, sourceTag, objectUrl);
      seenIds.add(externalId);
      if (r === "inserted") inserted++;
      else if (r === "updated") updated++;
    }
  }

  return { inserted, updated };
}

async function upsertOne(
  event: ICAL.Event,
  externalId: string,
  startsAt: Date,
  endsAt: Date,
  sourceTag: IcloudSourceTag,
  objectUrl: string,
): Promise<"inserted" | "updated" | "skipped"> {
  const title = event.summary ?? "(bez názvu)";
  const description = event.description ?? null;
  const locationText = event.location ?? null;
  const allDay = isAllDayEvent(event);

  const type: EventTypeStr = await classifyEvent({
    title,
    description,
    locationText,
    allDay,
    source: sourceTag,
  });

  const data = {
    source: sourceTag,
    externalId,
    sourceUrl: objectUrl,
    type: type as never,
    title,
    description,
    locationText,
    locationId: null,
    startsAt,
    endsAt,
    allDay,
    timezone: "Europe/Prague",
    etag: null,
    deletedRemotely: false,
    lastSyncedAt: new Date(),
  };

  const existing = await prisma.calendarEvent.findUnique({
    where: { source_externalId: { source: sourceTag, externalId } },
    select: { id: true },
  });

  if (!existing) {
    const created = await prisma.calendarEvent.create({ data });
    void extractPrepInBackground(created.id, title, description);
    return "inserted";
  }
  await prisma.calendarEvent.update({ where: { id: existing.id }, data });
  void extractPrepInBackground(existing.id, title, description);
  return "updated";
}

async function extractPrepInBackground(eventId: string, title: string, description: string | null): Promise<void> {
  if (!description || !description.trim()) {
    try {
      await prisma.calendarEvent.update({
        where: { id: eventId },
        data: { prepNote: null, itemsToBring: [] },
      });
    } catch { /* ignore */ }
    return;
  }
  try {
    const { extractCalendarPrep } = await import("./calendar-prep-ai");
    const prep = await extractCalendarPrep({ title, description });
    await prisma.calendarEvent.update({
      where: { id: eventId },
      data: { prepNote: prep.prepNote, itemsToBring: prep.itemsToBring },
    });
  } catch (e) {
    console.warn(`[icloud-calendar prep ${eventId}]`, e instanceof Error ? e.message : String(e));
  }
}

function isAllDayEvent(event: ICAL.Event): boolean {
  // ical.js: startDate.isDate === true znamená VALUE=DATE (celodenní)
  const sd = event.startDate as any;
  return Boolean(sd?.isDate);
}
