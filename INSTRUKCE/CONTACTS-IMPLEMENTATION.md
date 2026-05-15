# Kontakty — implementace iCloud sync + tabulkový editor

> Stav 2026-05-15: **Fáze 1 HOTOVÁ.** Tabulková editace + iCloud CardDAV sync
> (pull + push + match) + skupiny + validační filtry.
>
> Budoucí fáze (Petrovo briefu `kontakty_brief.md`): duplicity detect/merge,
> Find & Replace, normalizace +420, import VCF/CSV, Google Workspace sync.

## TL;DR

Petr má v `kontakty_brief.md` 14 sekcí — postavili jsme **fundamentální vrstvu**:

1. iCloud kontakty se stahují do Rašeliniště DB (CardDAV)
2. Tabulkový editor s single-click edit, pagination, search, validační filtry
3. Změny se ukládají do DB + jednotlivě pushují zpět na iCloud
4. Apple skupiny se synchronizují jako `ContactGroup` + denormalizace na `Contact.groups[]`
5. **Overlay model** — Rašeliniště drží `isVip` / `aliases` / `clientTag` / `callLogToken` / `isTeam` / `clientTagAliases`; tyto pole iCloud nevidí, sync je nepřepisuje

## Architektura

```
                ┌──────────────┐
                │   iCloud     │  CardDAV (https://contacts.icloud.com)
                │   Contacts   │
                └──────┬───────┘
                       │ Basic Auth (Apple ID + app password
                       │   sdílený s icloud-calendar.ts)
                       │
                ┌──────▼───────────────────┐
                │  src/lib/carddav.ts      │  discovery + LIST + REPORT + PUT + DELETE
                └──────┬───────────────────┘
                       │
                ┌──────▼───────────────────┐
                │  src/lib/vcard.ts        │  parseVCardFull + buildVCard (3.0 subset)
                └──────┬───────────────────┘
                       │
                ┌──────▼───────────────────┐
                │  src/lib/icloud-contacts.ts │  pull/push/match logic
                └──────┬───────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   ┌─────▼─────┐   ┌────▼─────────┐
   │ Contact │   │ContactGroup│  │UserIntegration│
   │  (DB)   │   │   (DB)    │   │ provider=icloud│
   └────┬────┘   └─────┬─────┘   └────────────────┘
        │              │
        │              └── memberUids[] → denormalizace na Contact.groups[]
        │
        └── overlay pole (isVip, aliases, clientTag, …) — Rašeliniště only
```

## Datový model (Prisma)

### Contact (rozšířeno migrací `20260514210000_icloud_contacts`)

Nová iCloud pole:
- `icloudUid` (unique) — vCard UID, stabilní napříč syncy
- `icloudEtag` — `If-Match` header při PUT (RFC 6352 optimistic concurrency)
- `icloudHref` — CardDAV path pro PUT/DELETE
- `lastIcloudSyncAt` — diagnostika
- `company` — ORG vCard field
- `addressLines: String[]` — multi-line adresa (sloučená z ADR komponent)
- `birthYear` — úplné datum (kromě birthMonth/Day které už byly)
- `groups: String[]` — denormalizace pro UI tabulky
- `syncSource` — `"icloud"` | `"google"` | `"manual"`

Indexy:
- `@@index([userId, icloudUid])` — rychlý re-sync lookup

### ContactGroup (nová tabulka)

Apple skupiny v CardDAV jsou samostatné vCardy s `KIND:group` + `X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:<UID>`.

- `name` + `userId` unique
- `memberUids: String[]` — UIDs členů (= Contact.icloudUid)
- `icloudUid/Etag/Href` — sync state

### UserIntegration provider="icloud" (sdílený s kalendářem)

Existující row z `icloud-calendar.ts` poskytuje credentials. Kontakty si nedotazují nové připojení — config field získá nová pole:
- `contactsAddressbookUrl` — cache po discovery
- `appleId` (existující) — Apple email
- (tokenEnc/Iv/Tag = app password, šifrované)

## Sync logika

### Pull (`pullIcloudContacts(userId)`)

```
1. getIcloudCredentials(userId) — credentials z provider=icloud
2. Cache addressbook URL (po prvním discovery)
3. listAddressbookItems() — PROPFIND Depth:1 → seznam {href, etag}
4. fetchAddressbookItems() — REPORT addressbook-multiget, chunk 100
5. parseVCardFull() — pro každou vCard
6. Pro každý parsed contact:
   a. Match podle icloudUid → re-sync (replace phones/emails)
   b. Match podle telefonu/emailu → first match (UNION, zachovat lokální)
   c. Žádný match → CREATE nový Contact
7. Pro každou parsed skupinu → upsert ContactGroup
8. refreshContactGroupsField — denormalizuj memberUids → Contact.groups
9. Update UserIntegration.lastUsedAt
```

**Kritické pro návaznosti**: `replacePhonesAndEmails` (re-sync) maže lokální
telefony/emaily. `mergePhonesAndEmails` (first match) zachovává lokální. Bez
tohohle by VIPka lookup, callLog, smart routing, Things imported telefony
zmizely při prvním sync.

### Push (`pushContactToIcloud(userId, contactId)`)

```
1. Načti Contact + phones + emails
2. Pokud nemá icloudUid → vygeneruj crypto.randomUUID()
3. buildVCard() → vCard 3.0 text
4. PUT na addressbook URL/<UID>.vcf s If-Match: <etag>
5. Pokud 412 → cizí změna, klient musí refetch
6. Po úspěchu update icloudEtag, icloudHref, lastIcloudSyncAt
```

## API endpointy

| Endpoint | Metoda | Účel |
|---|---|---|
| `/api/contacts/icloud/sync` | POST | Plný pull z iCloudu |
| `/api/contacts/icloud/push` | POST `{contactId}` | Push single contact |
| `/api/contacts/icloud/test` | POST | Test connection + count |
| `/api/contacts/tabulka` | GET `?page&pageSize&q&validation` | List s pagination + filtry |
| `/api/contacts/tabulka` | PATCH `{changes: [...]}` | Bulk save dirty rows |

## UI

### `/contacts/tabulka` (Astro page + ContactsTable.tsx React island)

**Hero hlavička:**
- Počet kontaktů + dirty counter
- iCloud status pill (🟢 / ⚠ s linkem na settings)
- Tlačítko **„Synchronizovat s iCloudem"**
- Tlačítko **„Uložit (N)"** — bulk save dirty

**Chip seznam skupin** (sekce 5.7 briefu):
- Pastel chips s počtem členů
- Klik = filter

**Toolbar:**
- Fulltext search (debounced 300ms)
- Validační filtr dropdown
- Page size 10/25/50/100/200

**Tabulka:**
- Sloupce: Jméno, Příjmení, Firma, Telefon, Telefon 2, Email, Skupiny, Narozeniny, Flag (VIP/TÝM/K), Push
- Single-click vstup do edit modu
- Enter potvrdí, Escape zruší
- Dirty řádky tinted rose
- Per-row push tlačítko (cloud upload icon)

**Sidebar entry:** „Kontakty — tabulka" pod existujícím „Kontakty".

## Návaznosti (důležité, nesmí se rozsypat)

| Modul | Závislost | Riziko po sync | Mitigace |
|---|---|---|---|
| VIPka `/call-log` | Phone.number exact match | Telefon zmizí | Union při first match |
| CallLog history | Contact.id | Žádné — Contact stays | OK |
| Smart routing (Todoist) | Contact.clientTag + aliases | clientTag/aliases overlay | Sync je nepřepisuje |
| BookingInvite | Contact.id | OK | — |
| Letter recipients | Contact.id | OK | — |
| Tasks (assignedTo) | Contact.id | OK | — |

**Co se v existujícím kódu nezměnilo:**
- `Contact.isVip`, `isClient`, `isFriend`, `isFamily`, `isTeam`, `clientTag`, `aliases`, `clientTagAliases`, `callLogToken`, `customGreeting`, `birthdayReminderDaysBefore`, `birthdayReminderChannels`, `note`, `defaultBookingMode`, `googleResourceName`, `lastGoogleSyncAt`, `importedFrom`, `externalId` — všechno overlay, sync je nečte ani nepíše.

## Bezpečnost

- **Auth**: HTTP Basic (Apple ID + app password). App password šifrovaný v `UserIntegration.tokenEnc` (AES-256-GCM).
- **Concurrency**: PUT s `If-Match: <etag>` → 412 pokud někdo upravil z jiného zařízení. Klient musí refetch.
- **Single user**: jediný admin v systému (JWT cookie session). PIN gate z briefu **vynechaný** (zbytečná dvojí autentikace).

## Co zbývá (budoucí fáze)

| Fáze briefu | Stav | Plán |
|---|---|---|
| 5.8 B — Duplicity v iCloudu | TBD | Detect podle jména/telefonu/emailu, merge UI s volbou primárky |
| 5.8 C — Find & Replace | TBD | Hromadná textová náhrada s regex/case-sensitive volbami |
| 5.8 D — Telefony +420 | TBD | Auto-detect 9místných CZ čísel + interactive normalize |
| 5.8 E — Import VCF/CSV | Částečně (legacy `parseVCardFile`) | Drag-and-drop + collision detect |
| 5.8 F — Obnova ze zálohy | TBD | Backup table před PUT/DELETE |
| 5.8 G — Google Workspace | Částečně (existující People API pull) | CardDAV push + 3-úrovňové párování + cleanup duplicit |
| 5.9 — Export VCF/CSV | TBD | Scope (vše/firma/skupina) + firemní export (7 polí) |
| 5.4 — Banner nově přidaných | TBD | Track seen UIDs + diff |

## Commits

- `175e2fd` — F1.1 Schema + migrace
- `a9f12de` — F1.2 CardDAV klient + vCard parser + sync logic
- `0e6db19` — F1.3-F1.7 API endpointy + tabulka + UI + sidebar

## Testovací postup

1. **Preconditions**: iCloud kalendář musí být připojený (Apple ID + app password v `/settings/integrations/icloud`). Pokud ne, doplň.
2. Otevři **`/contacts/tabulka`** v sidebaru.
3. Klikni **„Synchronizovat s iCloudem"** → pulluje vCardy + skupiny → reload.
4. V tabulce: klikni na buňku → změň hodnotu → Enter → další řádek → dirty se počítá.
5. Klikni **„Uložit (N)"** → bulk PATCH → DB se updatuje.
6. Pro push změny do iCloudu klikni **⤴** v posledním sloupci řádku → PUT vCard.
7. Po sync zkontroluj na **`/contacts`** (původní form) že VIP/TEAM/clientTag/aliases jsou zachované.

## Známé limity / TODO

- **Apple skupina rename** — pokud se v iCloudu skupina přejmenuje, vznikne v DB **nová** ContactGroup (icloudUid match) ale stará zůstane. Detekce orphans + auto-clean TBD.
- **Smazání kontaktu** v iCloudu (Apple Contacts app) — Rašeliniště DB ho po sync neuvidí jako smazaný. Potřeba diff baseline. Zatím manuální cleanup.
- **Throttling** — sync 1000 kontaktů = 1000 multi-get requestů (po chunks 100 = 10 calls). Pro velké addressbooky (5k+) může být sleep mezi chunks. Zatím no-throttle, Apple drží.
- **Conflict UI** — pokud PUT vrátí 412 (cizí změna), backend hodí error. Klient nedostane návod „klikni Synchronizovat a zkus znovu". TBD UX.

## Filozofie (z Petrova briefu)

1. **Žádné automatické pozadí** — sync je explicitní akce, ne cron
2. **Single-click editace** — žádné modální okno na úpravu jednoho pole
3. **Always show consequences** — counter dirty změn, confirm před destruktivními akcemi (TBD)
4. **iCloud zůstává zdrojem pravdy** — Rašeliniště zrcadlí + overlay
5. **Recoverable by default** — TBD backup tabulka, zatím PUT s If-Match
