# Kontakty modul — kompletní implementace (kontakty_brief.md)

Stav: **2026-05-15 — VŠECH 8 FÁZÍ HOTOVÝCH** ✅

Brief: `kontakty_brief.md` v rootu repo.

## Architektura

```
[iCloud Contacts]              [Google Workspace]
        ↑↓                              ↑↓
   CardDAV (Apple)               People API (REST)
        ↑↓                              ↑↓
[carddav.ts] [vcard.ts]   [google-contacts-sync.ts]
        ↑↓                              ↑↓
[icloud-contacts.ts]                  ↑↓
        ↑↓                              ↑↓
   [Prisma DB — Contact, ContactGroup, ContactBackup, ContactEmail, Phone]
        ↑↓
   [API /api/contacts/* — REST endpointy]
        ↑↓
   [/contacts/tabulka — ContactsTable + ContactsTools + ContactsNewsBanner]
```

**Overlay model:** iCloud drží core fields (jméno, telefony, emaily, adresa,
narozeniny, firma, skupiny). Rašeliniště drží **overlay** (isVip, aliases,
clientTag, callLogToken, isTeam, ...) — sync se ho **netýká**.

## Schema (Prisma)

### Rozšíření modelu Contact

```prisma
// iCloud CardDAV sync
icloudUid          String?   @unique
icloudEtag         String?
icloudHref         String?
lastIcloudSyncAt   DateTime?

// Core fields rozšířené pro plný kontakt model (vCard 3.0)
company            String?
addressLines       String[]  @default([])
birthYear          Int?
groups             String[]  @default([])
syncSource         String?   // "icloud" | "google" | "manual" | "restore"
```

### Nové modely

- **`ContactGroup`** — Apple skupiny jako samostatné vCardy (`KIND:group`
  + `X-ADDRESSBOOKSERVER-MEMBER`)
- **`ContactBackup`** — automatické zálohy vCard 3.0 snapshot před PUT/DELETE/merge

### Migrace

| Migrace | Co dělá |
|---|---|
| `20260514210000_icloud_contacts` | Contact iCloud sloupce + ContactGroup |
| `20260515110000_contact_backups` | ContactBackup tabulka |
| `20260515120000_contacts_baseline` | User.contactsSeenBaselineAt |

## Fáze 1 — iCloud CardDAV sync (commits `175e2fd` … `74b3c27`)

**Soubory:**
- `src/lib/vcard.ts` — parser/serializer vCard 3.0 (`parseVCardFull`, `buildVCard`)
- `src/lib/carddav.ts` — CardDAV klient (discoverAddressbook, list, multiget, putVCard, deleteVCard, testConnection)
- `src/lib/icloud-contacts.ts` — high-level sync (pullIcloudContacts, pushContactToIcloud)

**Match strategie (A):**
1. `icloudUid` match (re-sync)
2. Telefon/email exact match (první sync — Petr má Contact z Things/Google/manual)
3. Jinak vytvoř nový

**Overlay pole se nepřepisují.**

**Apple kvirky řešené:**
- Default XML namespace `xmlns="DAV:"` bez prefixu (regex tolerantní `(?:\w+:)?`)
- Redirect na `p<DC>-contacts.icloud.com` po Basic Auth — update baseHost
- Credentials sdílené s kalendářem (`provider="icloud"` row)

## Fáze 2 — Duplicity detect + merge (commit `b840750`)

**Soubor:** `src/lib/contacts-duplicates.ts`

- **Union-find clustering** podle jména (case-insens), telefonu (posledních 9 číslic), emailu (lowercase)
- **Merge logika:**
  - Primary zachová ID, icloudUid, overlay pole
  - Skalární doplnění z prvního non-empty secondary
  - Telefony/emaily/skupiny: union (dedup)
  - Overlay (isVip/isTeam/isClient/...): true sekundárního propaguje
  - Aliases + clientTagAliases: union
  - Re-link vazeb (CallLog, BookingInvite, Task assignee)
  - Auto-backup secondary před delete
- **API:** `GET /api/contacts/duplicates` (clusters) + `POST` (merge)
- **UI:** `ContactsDuplicates.tsx` (radio buttons primárka + expand/collapse)

## Fáze 3 — Find & Replace + Normalizace +420 (commit `b840750`)

**Soubor:** `src/lib/contacts-tools.ts`

**Find & Replace:**
- Sloupce: displayName / firstName / lastName / company / note / phones / emails
- Regex + case-sensitive volby
- Preview (top 20) + apply flow

**Normalizace +420:**
- Skip `+` nebo `00` (mezinárodní)
- 9-místné CZ rozsahy: mobile `60[1-8]`, `70[2-9]`, `72-77x`, `79x`; pevné `2x`, `3[1-9]`, `38x`, `4x`, `5x`
- 🟢 high confidence (CZ-likely, default checked) / 🟡 ambiguous (default unchecked)
- Format: `+420 XXX XXX XXX`

**API:** `POST /api/contacts/find-replace`, `GET/POST /api/contacts/normalize-phones`

## Fáze 4 — Import/Export VCF/CSV (commit `8cf63f2`)

**Import** (`src/lib/contacts-import.ts`):
- **VCF**: parse BEGIN:VCARD/END:VCARD bloky přes `parseVCardFull`
- **CSV**: sniffer separator (`;` / `,`), mapování českých+anglických hlaviček
- **Collision detect**: phone (posledních 9) / email exact match
- Preview vs apply flow, overwrite checkbox
- **API:** `POST /api/contacts/import-vcf-csv` (multipart, max 10 MB)

**Export** (`src/lib/contacts-export.ts`):
- Formáty: **VCF** (vCard 3.0 přes `buildVCard`) nebo **CSV** (UTF-8 BOM, středník, Excel-friendly)
- Scope: vše / `company:X` / `group:Y`
- **Firemní mode**: jen 7 polí (Jméno, Příjmení, Firma, Telefon mobile prefer, Druhý telefon, Narozeniny, E-mail primary)
- Filename: `kontakty_<scope>[_firemni]_<datum>.<ext>`
- **API:** `GET /api/contacts/export?format=&scope=&firemni=`

## Fáze 5 — Backup + Restore (commit `8cf63f2`)

**Soubor:** `src/lib/contacts-backup.ts`

**Auto-zálohy** před každým:
- `before_put` — PUT do iCloudu (push)
- `before_delete` — DELETE z DB (single + bulk)
- `before_merge` — sekundární kontakt v duplicit merge

**Cleanup:** drží 500 záloh per user, UI listuje 80.

**Restore:** parse vCard ze zálohy → update existující (po contactId match) nebo create nový. Phones/emails reset.

**API:** `GET /api/contacts/backups` (list) + `POST` (restore)

## Fáze 6 — Google Workspace (commit `6eb985c`)

**Soubor:** `src/lib/google-contacts-sync.ts`

**OAuth scope rozšířen:** `contacts.readonly` → `contacts` (read+write). Reauth banner v `/settings/integrations/google` při prvním použití.

**Funkce:**
1. **Push iCloud → Google** (`syncIcloudToGoogle`):
   - 3-úrovňové párování: `googleResourceName` → FN+(tel|email) → tel
   - Pro každý Rašeliniště kontakt: match (update) nebo create
   - Etag-based concurrency (If-Match)
   - Throttle 120ms (~8 req/s)

2. **Cleanup duplicit** v Googlu (`cleanupGoogleDuplicates`):
   - Union-find přes phone/email/name
   - Keep preference: match s `Contact.googleResourceName`, jinak nejmenší
   - Bulk delete non-keep

3. **Pull-back** (`pullBackFromGoogle`):
   - Kontakty co existují jen v Googlu (žádný overlap se naším DB)
   - syncSource=`google`, importedFrom=`google`

**API:**
- `POST /api/contacts/google/sync` (scope volitelný)
- `GET/POST /api/contacts/google/cleanup`
- `GET/POST /api/contacts/google/pullback`

## Fáze 7 — Banner novinek + bulk + skupiny + delete (commit `6eb985c`)

**Banner „Nově přidané z mobilu":**
- `User.contactsSeenBaselineAt` — timestamp posledního „mark prohlédnuto"
- Filter: `createdAt > baseline AND syncSource=icloud`
- API: `GET /api/contacts/news`, `POST` (mark seen)
- UI: `ContactsNewsBanner.tsx`

**Bulk akce** (`POST /api/contacts/bulk`):
- `delete` — auto-backup pak deleteMany
- `add-group` / `remove-group` — pro každého: groups union/diff
- Max 500 IDs per call

**Skupiny CRUD** (`/api/contacts/groups`):
- GET — list s počty členů
- POST — vytvoří (case-ins dedup)
- DELETE — smaže + odstraní z Contact.groups u všech členů

**DELETE /api/contacts/:id** rozšířen o auto-backup.

## Fáze 8 — UI integrace (commit `02edce9`)

**`ContactsTools.tsx`** — accordion s 8 sekcemi:
- A) Validace (počty kategorií)
- B) Duplicity v iCloudu (mountuje ContactsDuplicates)
- C) Find & Replace
- D) Normalizace +420
- E) Import VCF/CSV
- F) Obnova ze zálohy (80 záznamů)
- G) Google Workspace (push + cleanup + pull-back)
- H) Export VCF/CSV (scope + format + firemní)

**`/contacts/tabulka.astro`:**
```
[Banner novinek] (ContactsNewsBanner)
[Hero header + tabulka] (ContactsTable)
[Nástroje] (ContactsTools)
```

**Sidebar:** „Kontakty — tabulka" (`lucide:table-2`, lavender)

**Settings:** `/settings/integrations/icloud` má sekci „Kontakty" (IcloudContactsSection) s Test connection + Stáhnout z iCloudu

## Klíčová rozhodnutí (zachovat při dalších iteracích)

1. **Overlay model** — iCloud core / Rašeliniště overlay. Sync se overlay nedotýká.
2. **PIN gate vyhozený** — JWT cookie auth stačí (single-user).
3. **Match (A)** — phone/email exact match při prvním sync, zbytek založí jako nový. Duplicity řeší F2 UI.
4. **Žádné npm závislosti** pro vCard/CardDAV — vlastní implementace.
5. **iCloud = source of truth** pro core fields. Při sync phones/emails se v DB **přepisují** na iCloud verzi.
6. **Google = mirror** — push iCloud→Google s 3-úrovňovým párováním proti duplicitám.

## Commity (chronologicky)

| commit | obsah |
|---|---|
| `175e2fd` | Schema F1.1 |
| `a9f12de` | vCard + CardDAV + iCloud sync F1.2 |
| `0e6db19` | Settings UI + API endpoints F1.3-4 |
| `bd6acc7` | ContactsTable F1.5-8 |
| `a898cc5` | F2 duplicity lib+API (WIP) |
| `c38647c` | CardDAV discovery fix (Apple) |
| `fcd18c9` | IcloudContactsSection v /settings/integrations/icloud |
| `74b3c27` | CardDAV XML namespace fix (Apple default DAV:) |
| `b840750` | F2 UI + F3 lib+API |
| `8cf63f2` | F4 + F5 |
| `6eb985c` | F6 + F7 |
| `02edce9` | F8 UI integrace |
| `c3f78bd` | Google sync **OBOUSMĚRNÝ** (původně jen push) |
| `5d01c20` | `&#13;` decoder + cleanup endpoint + sloupec adresa + export podle firmy |
| `e507079` | parser odmítá prázdné kontakty + match phoneKey + Google sync tlačítko v hero |
| `2998b20` | match L2 na všechny kontakty (i s icloudUid) + auto-merge UI |
| `716f880` | parser sanitize všech stringů + auto-merge po každém sync + rate-limit |
| `ab7ce26` | `&#13;` v adresách — speciální handler zachová `\n` mezi řádky |
| `5d809a3` | rozdělené sync stavy iCloud/Google (spinner crosstalk) |
| `2b4c75f` | Nuclear reset endpoint — smaže non-overlay, sync iCloud znovu |
| `08ff2d8` | cleanup Google vrací detail chyby (typicky scope `contacts` write) |
| `7d37951` | diagnostic endpoint `/api/contacts/diagnose` + UI sekce |

## Provozní gotchas (důležité)

### Google scope reauth (vyžaduje uživatelskou akci)

Po deployi `e507079` (rozšíření `contacts.readonly` → `contacts` read+write):
1. Petr musí jít na `/settings/integrations/google`
2. Klik **Reautorizovat**
3. Google consent screen → odsouhlas nové scopy
4. Bez tohoto kroku **Google delete vrací 403** „insufficient authentication scopes" — commit `08ff2d8` vrátí konkrétní hlášku do UI.

### `&#13;` v datech (Apple CardDAV gotcha)

Apple iCloud posílá `&#13;` (HTML entity pro CR) v XML response. Pokud něco
proletí přes parser nedotčeně:
- **Cleanup endpoint** `/api/contacts/cleanup-entities` — projede všech 5 string fields + addressLines + groups
- **Tlačítko v UI** „Vyčistit entity + prázdné" v Nástrojích banneru
- **Detail handler** pro adresy (`decodeAddress`) — zachová `\n` mezi ulice/město/země

### Duplicity po sync

I po fix v `716f880` (parser sanitize) mohou vzniknout duplicity. Tři vrstvy obrany:
1. **Parser sanitize** — strip CR/LF/TAB ze všech stringů
2. **Match L2** v `upsertContact` přes phoneKey na VŠECHNY kontakty (i s icloudUid — Apple UID rotation)
3. **Auto-merge po sync** — automaticky volá `findDuplicateClusters` + `mergeContacts`

Pokud po sync přesto vzniknou duplicity, **Nuclear reset** (`2b4c75f`) smaže všechny non-overlay kontakty a sync iCloudu znovu = čistý dataset.

### Diagnostika

`/api/contacts/diagnose` GET vrátí breakdown:
- per syncSource, per importedFrom
- overlay flags counts
- duplicate clusters s top 5 příklady
- 20 nejnovějších kontaktů s timestamp + source

UI sekce „Diagnostika" v Nástrojích (žlutá butter), tlačítko „Spočítat".

## Workflow pro Petra (cheat sheet)

**Čerstvý start (jednou):**
1. `/settings/integrations/icloud` → Test připojení → Stáhnout z iCloudu
2. `/contacts/tabulka` → Nástroje → cleanup banner → „Vyčistit entity + prázdné"

**Pokud duplicity:**
1. Nástroje → „Diagnostika" → Spočítat → screenshot
2. Pokud cluster < 50: Nástroje → Duplicity → Najít → manuálně merge
3. Pokud cluster > 50: Nástroje → cleanup banner → „Auto-merge duplicity"

**Pokud naprostý bordel:**
1. Nástroje → cleanup banner → **„💣 Nuclear reset"** → napiš `SMAZAT`
2. Hero → „Synchronizovat s iCloudem"
3. Po sync uvidíš čistý dataset

**Google sync (po reauth):**
1. Hero → „Synchronizovat s Google" (obousměrný, last-write-wins)
2. Nebo Nástroje → Google Workspace → 3 akce zvlášť

**Export:**
- Nástroje → Export VCF/CSV → scope (vše / firma / skupina) + format → Stáhnout

**Editace tabulky:**
- Single-click do buňky → změna → Enter → další řádek
- Bulk Uložit v hero (tlačítko se countem dirty)
- Per-row tlačítko push do iCloudu (cloud-upload ikona vpravo)

## Známé omezení

- **Drafts JSON soubor** (brief 5.6) — neimplementováno, dirty stav je v paměti komponenty.
- **80 záloh v UI** vs `TOTAL_KEEP = 500` v DB — UI list je limit, DB drží víc.
- **Google scope reauth** — Petr musí ručně reauth Google integration při prvním F6 push.

## Test postup po deploy

1. Push všech commitů z GH Desktopu → ghcr build → DSM pull → restart
2. Migrace 3× se spustí auto v `docker-entrypoint.sh`
3. `/settings/integrations/icloud` → sekce „Kontakty" → **„Test připojení"** → uvidíš počet vCardů
4. **„Stáhnout z iCloudu"** → pull (1-2 min pro tisíc kontaktů)
5. `/contacts/tabulka`:
   - Banner novinek (pokud jsou nové od baseline)
   - Tabulka kontaktů (single-click edit)
   - Nástroje sekce → vyzkoušej Duplicity, F&R, +420
6. Pro Google sync: nejdřív reauth v `/settings/integrations/google` (banner upozorní), pak Nástroje → Google Workspace → Push vše
