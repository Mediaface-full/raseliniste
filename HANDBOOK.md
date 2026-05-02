# Rašeliniště — Handbook

Osobní informační systém Petra „Gideona" Perniy. Jeden uživatel, maximum bezpečnosti, postupné rozšiřování.

> **TL;DR:** Astro 6 + React 19 islands + Prisma 7 + PostgreSQL 16, běží na Synology DS718+ v Dockeru, deploy přes ghcr.io. Design **Liquid Glass** na dark navy pozadí. Login je **heslo + passkey (Touch ID)**. Jedenáct živých modulů: Capture, Úkoly, Poznámky, Deník, Zdraví, Kontakty (vCard + Google sync), Gideonův Firewall, Dopisy, Studna, **Kalendář (Google sync — fáze 1a; iCloud + rules + /quickadd ve fázi 1b)**, E-mail SMTP. AI běží na **Vertex AI** (EU region) nebo Gemini API key.

> **NOVÁ SESSION:** přečti nejdřív [`HANDOFF.md`](./HANDOFF.md) — má aktuální stav, rozdělané věci a immediate next steps.

---

## Obsah

1. [Rychlý start](#rychlý-start)
2. [Stack](#stack)
3. [Struktura repa](#struktura-repa)
4. [Datový model](#datový-model)
5. [Moduly — aktuální stav](#moduly--aktuální-stav)
6. [Auth](#auth)
7. [Gemini modely](#gemini-modely)
8. [API reference](#api-reference)
9. [Design system](#design-system)
10. [Vývojový workflow](#vývojový-workflow)
11. [Deploy na Synology](#deploy-na-synology)
12. [Email (Resend)](#email-resend)
13. [Cron na Synology](#cron-na-synology)
14. [iPhone Shortcuty a HAE](#iphone-shortcuty-a-hae)
15. [Provoz a troubleshooting](#provoz-a-troubleshooting)
16. [Roadmap](#roadmap)

---

## Rychlý start

Předpoklady: Node 22+, Docker Desktop, macOS/Linux.

```bash
# 1. deps
npm install

# 2. local Postgres (docker-compose.dev.yml)
docker compose -f docker-compose.dev.yml up -d

# 3. .env.local — pokud neexistuje, zkopíruj z .env.example a doplň hodnoty:
#    DATABASE_URL, SESSION_SECRET, GEMINI_API_KEY, APP_URL,
#    ADMIN_USERNAME, ADMIN_PASSWORD
#    (volitelně RESEND_API_KEY, NOTIFICATION_FROM/EMAIL, CRON_SECRET)

# 4. migrace + seed admin uživatele (Gideon)
npx prisma migrate deploy
npm run db:seed

# 5. dev server
npm run dev
# → http://localhost:3000/login
```

Pokud Gideon ještě nemá passkey, po zadání hesla tě systém pošle na `enrollment`. Potvrď Touch ID. Další login už bude password + Touch ID.

### Jednorázový import zdravotních dat z HAE

```bash
npm run health:import -- ~/Downloads/HealthAutoExport-<range>.json
# Naimportuje všechny metriky + ECG do DB. Re-run je bezpečný (unique index).
```

---

## Stack

| Vrstva | Technologie | Poznámka |
|---|---|---|
| Jazyk | TypeScript 5 (strict) | |
| Runtime | Node.js 22 (Alpine v Dockeru) | |
| Framework | **Astro 6** (output: server) | Node adapter v `mode: "standalone"` |
| React | 19 | jen pro interaktivní islands |
| DB | **PostgreSQL 16 Alpine** | druhý Docker kontejner |
| ORM | **Prisma 7** + `@prisma/adapter-pg` + `pg` | nový generator v `src/generated/prisma` |
| Styling | **Tailwind v4** + shadcn-style tokeny + vlastní `glass` utility | OKLCH, dark-only |
| Fonty | **Fraunces** (serif), **Geist** (sans), **Geist Mono** | přes `@fontsource-variable/*` |
| Ikony | **Lucide** (`astro-icon` + `@iconify-json/lucide` + `lucide-react`) | |
| Auth | argon2id + jose JWT cookies + WebAuthn/passkey | `@simplewebauthn/*` |
| Validace | **zod** | každý API endpoint |
| AI | `@google/genai` (Gemini 2.5 Flash/Pro) | klíč výhradně server-side |
| Grafy | **Recharts** 3 | Health dashboard |
| Markdown | **marked** | pro Gemini analýzy v prose styling |
| Email | **Resend** (HTTP API) | fallback na log v dev |
| Deploy | Docker multi-stage → ghcr.io → Synology DS718+ | viz `SYNOLOGY_DEPLOY_PATTERN.md` |
| CI | GitHub Actions (`.github/workflows/docker-build.yml`) | build + push na main |

---

## Struktura repa

```
raseliniste/
├── src/
│   ├── pages/
│   │   ├── index.astro                     # Dashboard (chráněný)
│   │   ├── login.astro                     # Login (password + passkey)
│   │   ├── capture.astro                   # Ruční vstup (fallback)
│   │   ├── triage.astro                    # Capture → Triage UI
│   │   ├── journal.astro                   # Deník — feed, search, filtry
│   │   ├── health.astro                    # Zdraví — dashboard + analýzy
│   │   ├── 404.astro                       # Glass 404
│   │   ├── settings/
│   │   │   ├── tokens.astro                # Správa API tokenů
│   │   │   ├── reports.astro               # Email notifikace — kam posílat
│   │   │   ├── shortcuts.astro             # iPhone Shortcut návod
│   │   │   └── ingest.astro                # Health Auto Export návod
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login.ts / logout.ts / me.ts
│   │       │   └── passkey/                # register-options, register-verify,
│   │       │                               # auth-options, auth-verify
│   │       ├── tokens/                     # index (GET/POST) + [id] (DELETE)
│   │       ├── settings/
│   │       │   └── reports.ts              # GET/PATCH notificationEmail
│   │       ├── ingest.ts                   # Capture POST (Bearer/cookie)
│   │       ├── triage.ts                   # GET pending entries
│   │       ├── entries/[id].ts             # PATCH edit/confirm/discard
│   │       ├── journal/
│   │       │   ├── ingest.ts               # Direct JOURNAL (Bearer/x-api-key)
│   │       │   ├── tags.ts                 # GET agregované tagy s počty
│   │       │   └── entries/                # index (GET list/POST manual) + [id] (PATCH/DELETE)
│   │       ├── health-ingest.ts            # HAE endpoint (x-api-key)
│   │       ├── health/
│   │       │   ├── summary.ts              # GET agregovaná data per typ
│   │       │   ├── analyze.ts              # POST manuální AI analýza
│   │       │   └── analyses/               # index (GET) + [id] (GET/DELETE)
│   │       ├── cron/
│   │       │   └── monthly-health-report.ts  # x-cron-key auth
│   │       └── ai/chat.ts                  # Gemini chat proxy
│   │
│   ├── layouts/
│   │   ├── Base.astro                      # HTML kostra + fonty + globální CSS
│   │   └── Shell.astro                     # Sidebar + topbar (chráněné stránky)
│   │
│   ├── components/
│   │   ├── ui/                             # Button (CVA variants), Input
│   │   ├── LoginForm.tsx                   # Multi-step login
│   │   ├── LogoutButton.tsx
│   │   ├── SidebarToggle.tsx               # Mobile off-canvas
│   │   ├── TokensManager.tsx               # /settings/tokens
│   │   ├── ReportsSettings.tsx             # /settings/reports
│   │   ├── ShortcutsGuide.tsx              # /settings/shortcuts (iPhone návod)
│   │   ├── IngestSetupGuide.tsx            # /settings/ingest (HAE návod)
│   │   ├── TriageList.tsx                  # /triage karty + edit
│   │   ├── CaptureForm.tsx                 # /capture textarea
│   │   ├── JournalFeed.tsx                 # /journal feed + search + tagy + date range
│   │   └── health/
│   │       ├── HealthDashboard.tsx         # KPI + sections + tabs
│   │       ├── HealthCharts.tsx            # Recharts wrappers
│   │       ├── HealthAnalyzeModal.tsx      # Modal pro ruční AI analýzu
│   │       └── HealthAnalysesList.tsx      # Historie uložených analýz
│   │
│   ├── lib/
│   │   ├── db.ts                           # Prisma lazy singleton (Proxy)
│   │   ├── env.ts                          # zod + lazy Proxy
│   │   ├── session.ts                      # JWT cookie session (AstroCookies)
│   │   ├── rate-limit.ts                   # LoginAttempt-based limits
│   │   ├── tokens.ts                       # API tokens (argon2 hash + verify)
│   │   ├── webauthn.ts                     # WebAuthn helpers + preauth/challenge
│   │   ├── classifier.ts                   # Gemini prompt pro Capture
│   │   ├── journal-redact.ts               # Gemini prompt pro Deník redakci
│   │   ├── health-parser.ts                # HAE JSON → DB rows
│   │   ├── health-import.ts                # Bulk insert s skipDuplicates
│   │   ├── health-query.ts                 # Agregace + stats + trend
│   │   ├── health-analyze.ts               # Gemini Pro analýza
│   │   ├── mailer.ts                       # Resend wrapper + log fallback
│   │   ├── gemini.ts                       # Gemini client (DEFAULT_MODEL, ANALYSIS_MODEL)
│   │   └── cn.ts                           # twMerge + clsx
│   │
│   ├── middleware.ts                       # Astro middleware: auth proxy + security headers
│   ├── styles/global.css                   # Tailwind + shadcn tokeny + glass utility
│   └── generated/prisma/                   # Prisma client (gitignored)
│
├── prisma/
│   ├── schema.prisma                       # 11 modelů, 5 enumů
│   ├── migrations/                         # 9 migrací
│   └── seed.ts                             # Admin user z ENV
│
├── prisma.config.ts                        # Prisma 7 config
├── astro.config.mjs                        # Astro + Node adapter + React + Tailwind
├── tsconfig.json                           # Strict + paths @/*
│
├── Dockerfile                              # 4-stage: base, deps, prod-deps, builder, runner
├── docker-entrypoint.sh                    # chown → heal → migrate → start
├── docker-compose.yml                      # app + postgres (produkce)
├── docker-compose.dev.yml                  # jen postgres (dev)
├── .dockerignore
├── .env.example                            # šablona pro produkční .env
│
├── .github/workflows/docker-build.yml      # Build + push ghcr.io
│
├── scripts/
│   ├── heal-migrations.mjs                 # Čistí stuck _prisma_migrations
│   ├── issue-smoke-token.ts                # Dev-only: vytvoří ApiToken pro testy
│   └── import-health-export.ts             # Jednorázový import HAE JSON
│
├── public/
│   └── favicon.svg                         # Pastelový gradient „R"
│
├── CLAUDE.md                               # Instrukce pro AI agenty
├── AGENTS.md                               # Trigger pro Claude aby četl docs
├── HANDBOOK.md                             # ← tento soubor
└── SYNOLOGY_DEPLOY_PATTERN.md              # Referenční deploy pattern
```

---

## Datový model

### Auth
- **User** — single user Gideon. `username` unique, `passwordHash` (argon2id), `lastLoginAt`, **`notificationEmail`** (kam chodí zdravotní reporty, override env).
- **Session** — DB záznam pro JWT cookie, 7denní TTL.
- **WebauthnCredential** — passkey per user.
- **LoginAttempt** — rate-limit tabulka.

### Capture
- **Recording** — surový vstup (`rawText`), `source`, `processedAt`, `processingError`.
- **Entry** — klasifikovaná položka.
  - `type: TASK | JOURNAL | THOUGHT | CONTEXT | KNOWLEDGE`
  - `status: PENDING | CONFIRMED | DISCARDED`
  - TASK: `suggestedProject`, `suggestedWhen`, `rationale`
  - KNOWLEDGE: `knowledgeCategory`, `knowledgeUrl`, `knowledgeTags[]`
  - **JOURNAL (obecné): `hashtags[]` (AI redakce), `location Json?` (GPS z iPhonu)**
  - `rawExcerpt`, `createdAt`, `confirmedAt`

### Tokens
- **ApiToken** — `name`, `tokenHash` (argon2 unique), `prefix`, `lastUsedAt`, `revokedAt`. Používá se pro Capture Bearer tokens, Journal direct, Health ingest.

### Health
- **HealthMetric** — univerzální tabulka pro 17 HAE typů.
  - `type`, `recordedAt`, `source`, `unit`
  - `qty` (14 metrik), `bpSystolic`/`bpDiastolic`, `sleepData` JSONB
  - `raw` JSONB
  - **`@@unique([userId, type, recordedAt, source])`** — idempotent ingest
- **HealthEcg** — voltage samples v JSONB.
- **HealthAnalysis** — AI analýzy (manuální + měsíční auto).
  - `periodFrom`, `periodTo`, `focus`, `trigger: MANUAL | MONTHLY_AUTO`
  - `text` (markdown odpověď), `model`, stats
  - `emailSentAt`, `emailError`

### Firewall (Gideonův) — kontakty + příchozí vzkazy
- **Contact** — `displayName`, `firstName`, `lastName`, `note`, **`isVip`**, `importedFrom` (`vcard`/`manual`), `externalId` (UID z vCard).
- **Phone** — E.164 normalizovaný, `label` (mobile/work/home/…). `@@unique([contactId, number])` + `@@index([number])` pro O(1) lookup příchozího vzkazu.
- **ContactEmail** — `email`, `label`.
- **CallLog** — `phoneNumber` (E.164), `rawNumber`, `contactId?`, `message`, `isUrgent`, **`wasVip`** (snapshot), `ip`, `userAgent`, `todoistTaskId?`, `todoistError?`, `mailSentAt?`, `mailError?`, `seenAt?`.
- **Contact.callLogToken / callLogTokenCreatedAt** — privátní VIP klíč pro `/call-log?t=<token>` a výpis Giďoušových misí. Auto-generuje se při `isVip = true`. 24 znaků base64url. Stabilní; regenerace přes UI v /contacts (zruší předchozí link). Lib `src/lib/call-log-token.ts` (`generateCallLogToken`, `ensureCallLogToken`, `regenerateCallLogToken`, `resolveCallLogToken` s defense-in-depth — pokud VIP odeberu, link přestane fungovat).

### Integrace (provider-agnostic credentials)
- **UserIntegration** — `provider` (`todoist` | `smtp` | budoucí), AES-256-GCM šifrované creds (`tokenEnc`/`tokenIv`/`tokenTag`), `config Json?`, `lastUsedAt`, `lastError`. Klíč šifrování derivovaný ze `SESSION_SECRET`.
  - **Todoist `config`**: `{ vyruseni, vip, mojeUkoly }` — IDs Todoist projektů.
  - **SMTP `config`**: `{ host, port, secure, user, from }` — heslo v `tokenEnc`.

### Tasks/Notes (extension Entry)
- **Entry** doplněn o `todoistTaskId`, `todoistProjectId` (push do Todoistu) a `completedAt` (mark done v /tasks /notes).

### Studna (sdílené projektové boxíky)
- **ProjectBox** — `name`, `homeTitle` (max 9 znaků pro „G: …" na ploše iPhone), `description` (kontext pro AI prompt), `extractionPrompt` (volitelný override), `studnaStandardPrompt`/`studnaBriefPrompt` (per-projekt Stage 2 prompt — priorita: tento override > DB global override > default v kódu; UI: sbalitelná sekce v detailu projektu Studánky/Prskavky), `includeInDigest` (zda zahrnout do denního souhrnu).
- **GuestUser** — globální host identita per email (per owner), `guestToken` v URL `/me/<token>`. Stejný host = stejný link napříč projekty (jeden link, jedna ikona na ploše).
- **ProjectInvitation** — many-to-many `GuestUser ↔ ProjectBox` s per-projekt permission `canRecordBrief`.
- **ProjectRecording** — `type: STANDARD | BRIEF`, `transcript` (vždy plný), `analysis Json` (strukturovaný JSON od Gemini), `audioPath` (cleanup cron maže STANDARD po 14 dnech, briefy + pinned navždy), `isPinned`, `isOwner`, `authorName` (snapshot).
- **ProjectSummary** — markdown výstup z `summarizeProject()` (Gemini Pro, briefy primární kontext).

### Dopisy
- **LetterSender** — `name` (interní), `legalName`, `ico`, `dic`, `addressLines[]`, kontakt (e-mail/telefon/web/banka), `logoPath`, `signaturePath`, **`redactPrompt`** (per-odesílatel AI prompt pro „Učesat"), **`pdfTheme`** (`classic` | `personal`).
- **LetterRecipient** — `name`, `addressLines[]`. Knihovna sdílená napříč dopisy; lze i ad-hoc per dopis.
- **Letter** — `senderId`, `recipientId?`, **snapshot adresáta** (`recipientNameSnapshot`, `recipientAddressLinesSnapshot`, `showRecipientAddress`), `letterDate`, `place?`, **`bodyRaw` + `bodyFinal`** (před/po Učesat), `promptOverride?`, **verzování** (`parentLetterId`, `version`), `pdfPath?` (cache).

### Kalendář & Bookingy (fáze 1a hotová, 1b+2+3+4 v plánu — viz HANDOFF.md)
- **CalendarEvent** — `source` (GOOGLE_PRIMARY / ICLOUD_SON / ICLOUD_PARTNER / RASELINISTE), `externalId`, `type` (EventType enum), `title`, `description`, `locationText`, `locationId` FK, `startsAt/endsAt`, `allDay`, `timezone`, `prepNote`, `itemsToBring Json`, `manualOverride`, `bookingInviteId?`, `etag`, `deletedRemotely`, `lastSyncedAt`. Unique `[source, externalId]`.
- **Location** — `name`, `aliases[]`, `commuteMinPeak/Off`, `isLocal`. Seedy: Praha (60/35), Jílové u Prahy (0/0 isLocal), Plzeň, Brno.
- **BookingInvite** — `token`, `mode` (CLIENT/FRIEND), `meetingType` (CHOICE_PRAGUE/ONLINE/HOME/ANY), `contactId?`, snapshot pole pro cold leady, `status` (PENDING/VIEWED/RESERVED/CONFIRMED/CANCELED/EXPIRED), `validUntil`, `reservedSlot Json`.
- **DayNote** — operativní úkoly bez času (errands "při cestě"). `forDate` (Date), `text`, `area?`, `done`, `doneAt`.
- **RuleViolation** — log post-hoc detekce přebookování. `forDate`, `eventId?`, `ruleName`, `severity` (INFO/WARNING/ERROR), `message`, `acknowledged`.
- **BriefingDigest** — záznam noční generace (22:00 cron → Todoist). `forDate` unique, `content Json` (schedule, itemsToBringAggregate, dayNotes, contextWarnings, commuteSummary), `todoistTaskId?`, `pushedAt?`.
- **Contact rozšíření**: `isClient`, `isFriend`, `isFamily`, `defaultBookingMode`, `googleResourceName` (unique), `googlePhotoUrl`, `lastGoogleSyncAt`.

### Enums
- `RecordingSource`, `EntryType`, `TaskWhen`, `EntryStatus`, `AnalysisTrigger`
- **Kalendář:** `CalendarSource`, `EventType`, `BookingMode`, `BookingMeetingType`, `BookingStatus`, `RuleViolationSeverity`

---

## Moduly — aktuální stav

### ✅ Auth (hotovo)
Heslo + passkey (WebAuthn). Viz [Auth](#auth).

### ✅ Capture (hotovo, Iterace 1 + KNOWLEDGE dodatek)
- Diktát → klasifikace → triage → potvrdit/zahodit
- `POST /api/ingest` (Bearer token z iPhone Shortcutu, nebo session cookie z `/capture`)
- Gemini 2.5 Flash rozdělí input na N entries s typem
- **5 typů**: TASK, JOURNAL, THOUGHT, CONTEXT, KNOWLEDGE
- UI: `/triage` — glass karty s pastelovou ikonou per typ, click-to-edit, „Změnit typ" dropdown (všech 5)
- Klasifikační přesnost ověřena na 16 reálných vstupech: **100 %**

### ✅ Deník (hotovo)
Samostatný modul s vlastním direct endpointem.
- `POST /api/journal/ingest` (Bearer / x-api-key, nebo session) — **bypass klasifikátoru**, rovnou `CONFIRMED`
- **AI redakce** přes Gemini Flash — vyčistí text, opraví gramatiku, doplní 3-5 hashtagů (temp 0.2, striktní prompt)
- **Raw text se vždy ukládá do `Recording.rawText`** jako fallback
- **Lokace** (volitelné) — `{ lat, lng, name?, accuracy? }` z iPhone Shortcutu
- UI: `/journal` — chronologický feed (Dnes / Včera / dny / měsíce)
  - **Fulltext search** (300 ms debounce)
  - **Date range filter** (7d / 30d / 90d / letos / vše / vlastní)
  - **Hashtag panel** — top 10 chips + expand se search boxem
  - **Pagination** — 30 zápisů/stránka + „Načíst starší"
  - **Origin toggle** per zápis (redigovaný ↔ raw)
  - **MapPin badge** odkaz na Apple/Google Maps
  - Nový zápis tlačítkem („Uložit 1:1" nebo „Uložit + učesat")

### ✅ Zdraví (hotovo)
- `POST /api/health-ingest` (x-api-key pro HAE, Bearer fallback)
- Univerzální tabulka pro 17 metrik + ECG
- **Historický roční import** 3 465 metrik za ~1 s
- **Idempotent** díky unique indexu
- Dashboard `/health` — 6 sekcí: Přehled / Aktivita / Srdce / Spánek / Tělo / Tlak
  - KPI karty s trendem, date range filter, Recharts (Line/Area/Bar/Stacked)
- **Manuální AI analýza** — tlačítko „Analyzovat" → modal s date range + focus presety → Gemini 2.5 Pro → markdown output
- **Historie analýz** — seznam pod dashboardem, detail modal, smazat
- **Měsíční automat** — `POST /api/cron/monthly-health-report` s `x-cron-key` auth, Synology Task Scheduler, poslední den v měsíci, email přes Resend

### ✅ Úkoly (hotovo)
- `/tasks` — CONFIRMED TASK entries grupované podle `suggestedWhen` (Dnes / Tento týden / Někdy / Bez termínu)
- Mark done (`completedAt`), delete, filter „zobrazit hotové"
- **Push do Todoistu** — tlačítko per úkol nebo automaticky z Triage (`pushEntryToTodoist` v `lib/todoist-push.ts`)
- Idempotentní (`Entry.todoistTaskId` cache)
- Mapping: `TaskWhen.TODAY → due_string="today"`, `THIS_WEEK → "this week"`, `SOMEDAY → no due`
- Labels: `capture` + `suggestedProject` + hashtags

### ✅ Poznámky (hotovo)
- `/notes` — CONFIRMED entries typu `KNOWLEDGE` + `THOUGHT`
- Search (text/rationale/url), filter by type/category/tag, archiv (`completedAt`)
- Karta zobrazí `knowledgeUrl` jako klik. odkaz, badge `knowledgeCategory`, hashtagy

### ✅ Kontakty (hotovo)
- `/contacts` — CRUD + VIP toggle + import vCard
- vCard parser v `lib/vcard.ts` (vCard 2.1/3.0/4.0, quoted-printable, continuation lines)
- Phone normalizace přes `libphonenumber-js` → E.164
- **Chunked import** — UI posílá dávky po 50 přes `?offset=&limit=`, řeší 60s nginx timeout u 1000+ kontaktů
- Dedup: `externalId` (vCard UID) → `phones[].number`
- Tlačítko 🔗 — zkopíruje personalizovaný `/call-log?phone=…&name=…` link pro VIP kontakt

### ✅ Gideonův Firewall (hotovo)
Veřejný endpoint pro lidi, kteří chtějí vyrušit, když nezvedám.
- `GET /call-log` (public, výjimka v middleware) — glass formulář, optimalizovaný mobile-first (formulář nahoře, ne centrovaný — klávesnice nepřekrývá)
- **Server-side enrichment**: pokud `?phone=` sedí na známý kontakt v DB, `firstName` se použije pro oslovení **JEN když isVip**, jinak žádné oslovení
- **`?phone=` skryje pole „Tvoje číslo"** přes `<input type="hidden">`
- `POST /api/call-log/submit` (public) — honeypot, rate-limit 5/10min/IP, normalizace phonu, lookup VIP
- **Při submitu:**
  - Vytvoří `CallLog` (snapshot kontaktu i `wasVip`)
  - Push do Todoistu — projekt podle isVip/isUrgent (vyruseni / vip), priorita 4 / 3 / 2, due `today` pro VIP+urgent
  - Mail (přes `sendMail`) — jen pro VIP nebo urgent
- **Apple touch icon** + `apple-mobile-web-app-capable` — VIP si uloží link na plochu jako appku, otevírá se bez Safari chrome, ikona velké serifové „G" na tmavé navy
- `/firewall` — historie, mark vyřízeno (`seenAt`), filtry urgent/VIP

### ✅ Dopisy (hotovo)
Generování PDF hlavičkových dopisů přes různé odesílatelské identity.
- `/letters` — archiv (search, filter per odesílatel, stáhnout PDF, regenerate, delete)
- `/letters/new` + `/letters/[id]` — editor s dvoupanelovým layoutem (text vlevo, metadata vpravo)
- **Per odesílatel:** logo, sken podpisu (PNG/JPG, max 4 MB), `redactPrompt` (vlastní AI prompt), `pdfTheme` (`classic` profesionální / `personal` osobní)
- **Per dopis:** datum + místo, adresát z knihovny nebo ad-hoc, toggle „zobrazit i adresu adresáta"
- **Tlačítko „Učesat"** — Gemini upraví styl podle prompt odesílatele + per-dopis override (např. „vypíchni tučně klíčové body")
- **PDF generátor** — `lib/letter-pdf.ts` přes `@react-pdf/renderer`, A4 portrét
  - Fonty Noto Sans + Noto Serif (kompletní česká diakritika; Helvetica defaultní v PDF padala na ě/š/č/ř/ž)
  - Šablony větveny v `LetterTemplate({ theme })`:
    - `classic`: adresát vpravo, plná patička (legalName · IČ · DIČ · email · phone · web · č.ú.)
    - `personal`: bez adresáta, patička jen legalName · email · phone · web (bez IČ/DIČ/č.ú.)
  - PDF cache na disk, invalidace při změně obsahu nebo redact
- **Verzování** — `parentLetterId` + `version`, regenerate vytvoří novou verzi (kopie obsahu, nový datum), parent zůstane
- **Disk persistence:**
  - `UPLOADS_PATH=/data/uploads` (Docker volume → `/volume1/docker/raseliniste/uploads`)
  - `lib/uploads.ts` — `saveUpload`, `deleteUpload`, `resolveUpload`, path-traversal blokovaný
  - `/api/uploads/[...path]` servíruje s ownership check (kontroluje, že file patří useru)

### ✅ Studna (hotovo)
Sdílené projektové boxíky s hlasovými záznamy.
- `/studna` — list projektů, KPI per projekt
- `/studna/:id` — detail, 4 taby: Záznamy, Hosti, Souhrny, Nastavení
- `/studna/nahravka` — owner recorder (jeden URL pro všechny projekty s dropdownem, jedna ikona na ploše)
- `/me/:guestToken` — public host page s MediaRecorder + countdown 10 min + auto-stop, kontextový dropdown projektů (1+ projektů)
- **Dva typy záznamů:**
  - **STANDARD** (Flash 2.5, max 10 min, audio cleanup po 14 dnech pokud není pinned)
  - **BRIEF** (Pro 2.5 hluboká analýza s glossary/actors/decision_history, max 90 min, file upload, audio nikdy nemizí)
- **AI rozbor:** strukturovaný JSON s `summary`, `key_themes`, `thoughts[]` (importance + rationale + category), `open_questions`, `sentiment`, `intensity_signals` (+ brief: `glossary`, `actors`, `decision_history`)
- **Project summary** — Pro model nad všemi recordings (briefy primární kontext) — strukturovaný markdown dokument o stavu projektu
- **Cron:** `daily-projects-digest` (**7:00 ráno** — okno posledních 24 h, 200znakové náhledy z transkriptu, předmět "Studna — N nových nahrávek (autoři)", patička link na `/studna/aktivita`; pokud nic nepřibylo, mail neposílá), `cleanup-audio` (03:00 — STANDARD older 14d & not pinned)
- **Onboarding PDFs** — 2 šablony (Standard + Brief) generované přes `@react-pdf/renderer`, owner si stáhne v admin a pošle hostovi mailem

### 🚧 Kalendář & Bookingy (fáze 1a hotová — Google sync; 1b+2+3+4 v plánu)

**Hotovo (fáze 1a):**
- Schema: `CalendarEvent`, `Location` (4 seedy), `BookingInvite`, `DayNote`, `RuleViolation`, `BriefingDigest` + `Contact` rozšíření o booking módy + Google sync fields
- `lib/google-oauth.ts` — OAuth 2.0 (Workspace), refresh token v `UserIntegration(provider="google")` šifrovaný AES-256-GCM
- `lib/google-calendar.ts` — incremental sync s `timeMin/timeMax` window (-7d/+60d), recurring expanded přes `singleEvents=true`, etag-based skip, upsert podle `[source, externalId]`. Plus `createGoogleEvent` (write s Meet) a `deleteGoogleEvent`.
- `lib/google-people.ts` — read-only sync přes `connections.list`, dedup podle `googleResourceName → email → phone`, sloučení do existujícího `Contact`.
- `lib/event-classifier.ts` — Vertex Flash classifier title+location → EventType, s heuristikou pre-filtrů (HOCKEY/SHIFT/VACATION/NOMAD/ONLINE regex) + Map cache v procesu.
- `/calendar` UI s react-big-calendar (default WEEK, Liquid Glass dark CSS), `/settings/integrations/google` (status, stats, sync, disconnect).
- Cron: `/api/cron/sync-calendars` (5 min), `/api/cron/sync-contacts` (denně 04:00).
- Sidebar: Kalendář první v Organizace.

**V plánu (fáze 1b/2/3/4 — viz brief Petra `raseliniste-kalendar-brief.md` a HANDOFF.md):**
- 1b: iCloud CalDAV sync (syn + partnerka), pravidlový engine (15+ pravidel), `/quickadd` parser
- 2: Bookingy (`/calendar/invite`, `/i/<token>`, `/schuzka` cold lead), magic-link flow
- 3: DayNote UI, Briefing 22:00 → Todoist, Capture integrace pro time-binding
- 4: OOO management, Locations admin, PWA polish

### ✅ B&W Myš — rozhodovací linka (hotovo 2026-05-02)
- **Účel:** strukturovaný rozhodovací systém pro emocionální rozhodovací styl s výkyvy nálad. Longitudinální sběr vstupů (default 14 dní) → AI vyhodnocení → uzavírací verdikt s definicí „co by ho překlopilo". Spec: `~/Downloads/rozhodovaci-system-zadani.md`.
- **Filozofie (PDF zadání):** žádný terapeutický tón, věcný/argumentační výstup, „uzavírací funkce" (rozhodnutí vyjde jako svědek, k němuž se uživatel už nemusí v hlavě vracet). **Pravidlo nevracení** = uzavřené rozhodnutí lze otevřít POUZE přes formálně vyplněný nový fakt zvenčí, NE přes pochybnost / náladu / opakovanou úvahu.
- **DB modely:**
  - `Decision` (nazev, kontext pracovni|osobni|smiseny, otazka, varianty Json[], predpoklady Json[], deadlineRozhodnuti, delkaSberuDny default 14, status aktivni|uzavrene_jdu|uzavrene_nejdu|odlozene|archivovane, datumUzavreni, datumRevize, odlozenoDo, verdiktText, coByZmeniloVerdikt)
  - `DecisionEntry` (datum, nalada 1-5, typVstupu enum {novy_fakt_zvenci, nova_uvaha, napadlo_me, reakce_na_udalost}, uhelPohledu Six Hats {fakta, emoce, kritika, prinosy, alternativy, meta, nevybrano}, obsah, audioPath/Mime/Bytes, uhelPohleduAi pro AI klasifikaci pokud nevybrano)
  - `DecisionEvaluation` (typ prubezne|finalni, obsahStrukturovany Json — sekce A-H pro finální, modelName, promptTokens, outputTokens)
  - `DecisionReopening` (popisNovehoFaktu, schvaleno bool — log Toku 6)
- **API:**
  - GET/POST `/api/bwmys` (list, vytvořit; query `?status=` nebo `?archive=1`)
  - GET/PATCH/DELETE `/api/bwmys/[id]` (detail, edit zarámování, smazat — kaskádově vše)
  - POST `/api/bwmys/[id]/entry` (text zápis, validace nálada+typ+obsah, vrací warnings o deadline/sber)
  - POST `/api/bwmys/[id]/entry-audio` (multipart audio → Stage 1 transcribeAudio cleanupFillers + Stage 2 extractEntryFromTranscript → Entry s vyextrahovanou náladou/typem/úhlem/obsahem)
  - POST `/api/bwmys/[id]/reopen` (Tok 6 znovuotevření — povinný popisNovehoFaktu min 5 znaků + schvaleno=true, posune deadline default +14 dní)
  - POST `/api/bwmys/[id]/evaluate` body `{typ, forceLowSample?}` (mini 3+ zápisů, finální 5+ s low-sample warning, pre-finální klasifikace AI úhlů pro nevybrano entries)
  - POST `/api/bwmys/suggest-variants` body `{otazka, soucasneVarianty}` (AI návrh dalších 2-3 variant — typicky odložení, menší verze, delegování, ne-akce)
  - GET `/api/bwmys/[id]/export` (Markdown export celého rozhodnutí: zarámování + entries + evaluations + verdikt)
  - POST `/api/bwmys/[id]/arguments` (extrakce mřížky argumentů z poslední finální DecisionEvaluation; cache do `argumentsJson`; `?force=1` vynutí regeneraci; vrací `{arguments: [{argument, smer, konzistence, cetnost, nalady_vyskytu}]}`)
- **AI lib `src/lib/bwmys-ai.ts` (5 promptů):**
  - `navrhniDalsiVarianty()` — Tok 1, krátký prompt
  - `miniVyhodnoceni()` — Tok 3, "zrcadlo, ne rozhodnutí" (rozložení nálad, opakující motivy, chybějící úhly, krátká poznámka)
  - `finalniVyhodnoceni()` — Tok 4, **8 sekcí A-H**: A statistika sběru (pocetZapisu, distribuceNalad, distribuceTypu, upozornění při slabém vzorku), B Six Hats analýza (6 pohledů s 2-4 odrážkami), C signál vs. šum (konzistentní/náladově skreslené/recyklované), D pre-mortem (5 nejpravděpodobnějších důvodů selhání), E 10/10/10 (10 minut/měsíců/let), F WRAP check (více variant?, otestované předpoklady?, dostatečný odstup?, plán B?), G kontextová kritéria (pracovni: obchodní/finanční/marketingový/náročnost/strategický fit; osobni: hodnoty/vztahy/čas+energie/reverzibilita/životní fáze; smiseny: oba bloky), H verdikt (doporučení, hlavní pro/proti, co by překlopilo, doporučená revize)
  - `klasifikujUhly()` — subprocess pro entries s "nevybrano", uloží do uhelPohleduAi
  - `extractArguments()` — vizualizační vrstva (05-02), max 12 argumentů (téma ≠ citace), každý {argument, smer −1..+1, konzistence 0..1, cetnost, nalady_vyskytu}; ukládá do `DecisionEvaluation.argumentsJson`
  - **Tón striktně věcný, NE terapeutický** (PDF specifikace explicitně zakazuje "vidím že tě to trápí" apod.)
- **UI komponenty:**
  - `BwMysList` — karty aktivních rozhodnutí (kontext ikona, počet zápisů X/5, dní do deadline, klik → detail)
  - `BwMysNew` — multi-step formulář 6 kroků (název+kontext, otázka s validací ?, varianty min 3 + AI návrh tlačítko, předpoklady min 1, termín+délka sběru, souhrn) s progress barem
  - `BwMysDetail` — hlavička (Pencil edit / Trash delete) + zarámování (sbalitelné) + časová osa zápisů (mood barevný puntík + typ + úhel) + vyhodnocení (sekce A-H render s emoji) + akční zóna (4 tlačítka: Jdu/Nejdu/Odložit/Víc dat) + close dialog s 4 módy + reopen dialog + edit framing modal + new entry modal + audio recorder modal
  - `BwMysAudioRecorder` — modal s mikrofonem (5 min limit, useRecordingProtection)
  - **`BwMysViz/` (vizualizační vrstva 05-02)** — sbalitelná sekce „Vizuální přehled" mezi Zarámováním a Časovou osou:
    - `SixHatsRadar` — Recharts RadarChart, 6 os, používá `effectiveUhel()` (manuální přebije AI fallback z `uhelPohleduAi`); od 1 klasifikovaného úhlu, varování na chybějící klobouky
    - `MoodCurve` — LineChart s body obarvenými dle nálady (`MOOD_COLORS`), tooltip s prvními 50 znaky obsahu, varování při swing ≥ 3
    - `EntryTypesDonut` — PieChart s `innerRadius`, střed = celkový počet zápisů, textový komentář dle distribuce (např. „převažují vlastní úvahy"); od 3 zápisů
    - `ArgumentsGrid` — ScatterChart, X = smer (−1..+1), Y = konzistence (0..1), velikost = cetnost (`ZAxis`), opacity = konzistence (≥0.5 plná, <0.5 průhledná), pro = mint, proti = rose, tooltip s textem argumentu + barevné tečky nálad výskytu, 4 popisky kvadrantů
    - `ArgumentsBanner` ve `FinalEvalRender` — auto-fetch při open, regenerate button (force=1), pod scatterem 3 menší grafy (radar/křivka/donut)
    - Sdílené barvy v `src/lib/bwmys-colors.ts` (hex přibližně z OKLCH `--tint-*`, Recharts neumí CSS proměnné)
  - Archive `/bwmys/archiv` — filtr status (uzavrene_jdu/nejdu/odlozene/all) + filtr kontext, export MD link, klik → detail (kde je tlačítko Znovu otevřít)
- **Cron `bwmys-tick`** (#15 v seznamu, denně 7:10):
  - Auto-návrat odložených rozhodnutí (status=odlozene + odlozenoDo<=now → status=aktivni)
  - Deadline alert 3 dny předem (email + push)
  - Sběr uplynul (datumVytvoreni + delkaSberuDny = dnes) → notifikace „zvaž finální vyhodnocení"
  - Datum revize uzavřených dnes → notifikace
- **Ikona:** `bwmys-touch-icon.png` (180/192/512) — dvě myšky v yin-yang kompozici (černá nahoře, bílá dole), kulaté uši s růžovými vnitřky, dvě očka s leskem, růžový/lavender čenich. SVG zdroj `public/bwmys-icon.svg`.
- **Sidebar + /start dlaždice** lavender tint (lucide:arrow-left-right).

### ✅ Web Push notifikace (hotovo 2026-05-01)
- **Účel:** mobilní push notifikace nezávisle na WhatsApp (Petr explicitně chtěl push místo WA)
- **Stack:** VAPID + Service Worker + `web-push` npm package
- **Klíče:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` v `.env`
  - Vygeneruj: `npx web-push generate-vapid-keys`
- **DB model:** `WebPushSubscription` (endpoint unique, p256dh, auth, label, lastUsedAt, lastError, cascade na User)
- **Service Worker:** `public/sw.js` — install/activate/push/notificationclick handlery
- **Lib:** `src/lib/webpush.ts` — `sendPushToUser(userId, payload)`, automatické čištění 410/404 subscriptions
- **API:** `GET/POST/PUT/DELETE /api/push/subscribe` (PUT = test push)
- **UI:** `/settings/push` — `PushSettings.tsx` React island s detekcí supported/permission, registrací, seznamem zařízení, test tlačítkem
- **Cron integrace:** `zijes-reminder` posílá push **místo** WhatsApp pokud user má aktivní subscription. Email vždy jako záloha.
- **iOS specifika (KRITICKÉ):**
  - Apple od iOS 16.4+ povoluje web push **JEN pokud je stránka přidaná na plochu jako PWA** (Sdílet → Přidat na plochu)
  - V Safari (bez PWA) push NEFUNGUJE
  - Uživatel musí appku otevírat **Z PLOCHY**, ne ze Safari
  - Widgety obvykle otevírají v Safari → push tam neprojde
- **Android:** funguje v Chrome i bez PWA

### ✅ ŽIJEŠ? (Check-in formulář, hotovo 2026-05-01)
- **Účel:** interocepční nástroj pro pravidelnou sebereflexi v hyperfokusu (ADHD/CPTSD)
- **PDF specifikace:** `Check-in_Formular_Zadani.pdf` (8 stran)
- **DB model:** `CheckIn` (type lunch/evening, lastMealAt/lastWaterAt HH:MM strings, bodyFeeling, mood 1-10, whatWorked, contacts, oldPattern)
- **Stránky:**
  - `/zijes` — archiv s mood barem (rose/butter/sage), datum (Dnes/Včera/...), snippety
  - `/zijes/novy?type=lunch|evening` — formulář (auto-detekce type podle hodiny do 16:00)
  - `/zijes/[id]` — read-only detail
- **Komponenta:** `CheckInForm.tsx` — sticky bottom bar, range slider 1-10, checkboxes „nepamatuju si", `Uloženo. Vrátíš se k tomu jak budeš chtít.`
- **Cron:** `/api/cron/zijes-reminder?type=lunch|evening` denně 13:00 a 18:00
  - Pošle push (primární) + email (záloha)
  - WhatsApp JEN pokud nemá push subscription
  - Tón: striktně neutrální (`Tady jsem, když chceš. Nemusíš.`)
  - Žádné retry, žádné opakování — záměrně
- **Pravidla z PDF (NESMÍ se porušit):**
  - Žádná penalizace (nevyplnění = nic se nestane)
  - Žádné streaks, body, gamifikace
  - Žádné statistiky kompletovanosti
  - Tón: nabídka, ne povinnost

### ✅ Výročí (hotovo 2026-05-01)
- **DB:** `Anniversary` (title, month, day, year?, note?, reminderDaysBefore?, reminderChannels[])
- **Stránky:** `/vyroci` — list karet + editor (modal)
- **Dashboard:** rose banner pokud je dnes výročí (na `/start` mobil i `/` desktop), jemný řádek nadcházejících (14 dní)
- **„Kolikáté výročí":** pokud je rok zadán, ukazuje `16. Výročí svatby`
- **Cron:** `/api/cron/anniversary-reminders` denně 7:05
  - Plus narozeniny kontaktů (Contact.birthMonth + birthdayReminderDaysBefore)
  - Email + push + WhatsApp podle channels[]
- **Kontakty rozšířené:** `Contact.birthdayReminderDaysBefore`, `birthdayReminderChannels[]`

### ✅ Prskavka (osobní projekty, hotovo 2026-05-01)
- **Účel:** paralelní svět ke Studánce — tvé osobní projekty (knížky, nápady), ne pro klienty
- **Architektura:** ŽÁDNÉ duplikování — flag `ProjectBox.isPrivate` + filter v UI/API
- **Stránky:** `/prskavka`, `/prskavka/nahravka`, `/prskavka/aktivita`
- **Sdílený kód:** recorder, AI pipeline, transkripce, RAG indexace, summary — vše stejné jako Studánka
- **Filtry:**
  - `/api/studna?private=1` → Prskavka, default → Studánka
  - `/studna/aktivita`, `/studna/nahravka` filtruje `isPrivate: false`
  - `daily-projects-digest` cron filter `isPrivate: false` (Petr si neemailuje sám sobě)
- **Detail projektu** `/studna/<id>` je sdílený (jeden projekt = jedna stránka, bez ohledu na isPrivate)

### ✅ Studánka (přejmenování ze Studna, 2026-05-01)
- **UI rename napříč všemi texty:** sidebar, hlavičky, breadcrumby, email subject, RAG citace, AI prompts editor, onboarding PDF, /me/<token> guest landing
- **URL ponecháno** `/studna/...` (bookmarky a guest linky `/me/<token>` zůstávají funkční)
- **Class/file/var názvy ponechány** (`StudnaList`, `StudnaDetail`, `StudnaSchema`) — interní, neviditelné
- **Cleanup citoslovcí:** `transcribeAudio()` má opt-in `cleanupFillers: true`, Studánka ho zapíná. Stage 1 prompt vyloučí ehm/eee/no/jakože/repetice. Petr může u starých nahrávek kliknout „Regenerovat" pro fresh přepis.
- **Per-projekt custom Stage 2 prompty (NOVÉ 2026-05-02):** každý ProjectBox může mít vlastní `studnaStandardPrompt` a `studnaBriefPrompt` — přebijí globální default jen pro daný projekt (Prskavka use case: jiný typ výstupu pro osobní projekty než pro klientská brainstorm). Ukládá se přes PATCH `/api/studna/:id`, v UI v záložce Nastavení sekce „⚙ Vlastní AI prompty pro tento projekt". Pokud aktivní, v hlavičce projektu se zobrazí lavender banner.

### ✅ Gideonův Firewall (rozšířený 2026-05-01)
- **VIP varianta `/call-log`** = oddělená entita s:
  - Personalizovaným oslovením („⭐ Ahoj, Karle ⭐" nebo vlastní override „⭐ Drahá dívko ⭐")
  - Polem na termín splnění (volitelné, type=date, min +2 dny dopředu)
  - Vlastními texty (`VIP_TEXTS` const v `/call-log/index.astro`):
    - Heading: „Zadej Gíďovi jeho misi."
    - Submit: „Vypusť Gíďu"
    - Placeholder textarea: „Co mu hodíš na hřbet?"
  - Animovanou G ikonou (`AnimatedG.astro`) s laser sweep + pulsující aurou
  - Apple title „Gíďo, máš misi"
- **Termín splnění** propíše do Todoist `due_date` YYYY-MM-DD + popisu „📅 Termín požadovaný od VIP"
- **Datum je VIP-only privilegium** — server ignoruje pole pokud volající nemá `isVip=true`
- **Title v Todoistu** pro VIP úkol = `⭐ <jméno>: <prvních 80 znaků zprávy>` (NE „Zavolat zpět")
- **Vokativ engine:** `src/lib/vokativ.ts` — tabulka 40+ výjimek + algoritmus pro běžné koncovky
- **Contact rozšíření:** `firstNameVocative` (manuální 5. pád), `greetingOverride` (úplný custom string)
- **Thanks page** `/call-log/thanks?phone=X` má VIP variantu „✦ Mise vypuštěna ✦" + tlačítko „Zadej další misi"

### ✅ Zeptat se (RAG, hotovo 2026-04-30)
- **Účel:** AI dotaz nad indexovanými deníky / úkoly / Studna nahrávkami. Odpověď s [N] citacemi prokliknutelnými na zdroj.
- **Stack:**
  - **pgvector 0.8.2** v Postgresu (image `pgvector/pgvector:pg16`)
  - **Embedding:** Gemini `text-embedding-004`, 768 dim, asymetrický `taskType` (RETRIEVAL_DOCUMENT pro index, RETRIEVAL_QUERY pro dotaz)
  - **Search:** cosine similarity přes `<=>` operator (raw SQL), top 8
  - **LLM:** Gemini 2.5 Pro generuje odpověď s [N] citacemi
- **DB:** model `RagChunk` — sourceType (journal/task/studna), sourceId, chunkIdx, text, embedding vector(768)
- **Chunking:** 600 znaků s 100 overlapem, dělí na hranicích vět/slov
- **Auto-indexace:** fire-and-forget s module-level Set pinningu (kritický pattern, viz #12 v INSTRUKCE/06-troubleshooting.md):
  - `/api/denik` POST → `indexEntity('journal', ...)`
  - `/api/ukoly` POST → `indexEntity('task', ...)`
  - `process-recording.ts` po `status=processed` → `indexEntity('studna', ...)`
- **API:** POST `/api/ask {question}` → `{question, answer, citations[]}`
- **UI:** `/zeptat-se` (Astro stránka) + `AskWidget` React island (Cmd+Enter, klikatelné citace, detail s shoda %)
- **Backfill:** záměrně neproveden — Petr explicitně řekl „jen od teď". Existující data se zaindexují až při uložení/edicí.
- **Lib:** `src/lib/rag.ts` — chunkText, embedText, embedQuery, indexEntity, unindexEntity, searchChunks, answerQuestion, getInFlightIndexSnapshot (diagnostika)
- **Náklady:** ~80 Kč/měs při 5 dotazech denně (Gemini text-embedding-004 free tier + Pro generation $0.001-0.005)
- **Výhled:** přidat backfill skript, mikrofon na zeptání hlasem, reindex tlačítko, cleanup orphan chunků cronem.

### ✅ E-mail (hotovo, dual SMTP/Resend)
- `lib/mailer.ts` — priorita: **SMTP z DB** → Resend env → log fallback
- `Nastavení → E-mail (SMTP)` — UI pro konfiguraci SMTP (Seznam/Gmail/Outlook preset + vlastní)
- Heslo šifrované AES-256-GCM v `UserIntegration(provider="smtp")`
- `transporter.verify()` při uložení — nedovolí ulož špatné credentials
- Tlačítko „Poslat testovací mail"
- Nahradilo Resend-only přístup (kolize s Seznam MX záznamy na apex doméně)

### ✅ AI (Vertex / AI Studio dual-mode)
- `lib/gemini.ts` — pokud `VERTEX_PROJECT` je vyplněný, klient běží na **Vertex AI** (region default `europe-west1`, autentizace přes `GOOGLE_APPLICATION_CREDENTIALS`)
- Jinak fallback na **`GEMINI_API_KEY`** (Google AI Studio)
- Startup log informuje, který mód běží
- `GET /api/health/ai` — health check vrátí `{ mode, ok, elapsedMs, sample }` přes test prompt
- `docker-compose.yml` má volume mount `./gcp-key.json:/app/gcp-key.json:ro`

### ✅ Settings (hotovo)
Skupina v sidebaru, sedm podstránek:
- `/settings/integrations` — Todoist token + 3 dropdowny (Vyrušení / VIP / Moje úkoly)
- `/settings/reports` — E-mail (SMTP konfigurace + sběrný email pro reporty)
- `/settings/shortcuts` — návod pro iPhone Shortcuty (Capture + Deník)
- `/settings/ingest` — návod pro Health Auto Export
- `/settings/letter-senders` — odesílatelé dopisů (CRUD + logo/podpis upload + per-sender prompt + theme)
- `/settings/tokens` — Rašeliniště API tokeny (pro iOS shortcut)

### 🔜 V plánu
- **Capture iPhone Shortcut** — zatím v návodu, JSON body připravený
- **Tasks/Notes pull sync z Todoistu** — pokud done v Todoistu, propsat do Rašeliniště
- **Verzování UI v archivu dopisů** — vidět seznam v1/v2/v3 daného dopisu
- **Další PDF témata** dopisů (kostra připravena, zatím classic + personal)
- **Push notifikace** pro VIP firewall vzkazy (web push nebo Telegram bot)
- **Ranní briefing** — Gemini shrne včerejšek + dnešek, denní cron
- **AI chat** — RAG nad vlastními daty (Recordings + Entries + Health)
- **Claude kouč** — integrace na Anthropic projekt
- **Superlist / Plaud** — externí integrace

---

## Auth

Dvoufázový login: **heslo → passkey**. Plná implementace v `src/lib/session.ts` + `src/lib/webauthn.ts` + `src/pages/api/auth/*`.

Flow:
1. `POST /api/auth/login` — argon2 verify + rate-limit → vystaví `rs_preauth` cookie (JWT, 5 min)
2. Browser volá `navigator.credentials.create()` nebo `.get()` → Touch ID
3. `POST /api/auth/passkey/{register,auth}-verify` → plná session cookie `rs_session` (7 dní)

Bezpečnostní vrstvy:
- argon2id, OWASP 2024 parametry
- Konstantní čas (dummy hash pro neexistujícího usera)
- Rate limit 5 failů/15 min per username, 20 per IP
- JWT cookie `httpOnly`, `sameSite: strict`, `secure` v produkci
- Session validace VŽDY přes DB
- WebAuthn vázaný na doménu (`rpID` z `APP_URL`) — **dev passkey v produkci NEFUNGUJE**, a naopak
- Security headers přes middleware: HSTS, X-Frame-Options: DENY, atd.

**Middleware** (`src/middleware.ts`) dělá jen optimistic check (cookie exists). Plná validace v handlerech přes `readSession(cookies)`.

Public paths (nepožadují cookie):
- `/login`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/passkey/*`
- `/api/ingest` (Bearer), `/api/journal/ingest` (Bearer/x-api-key)
- `/api/health-ingest` (x-api-key)
- `/api/cron/*` (x-cron-key)
- **`/call-log`, `/call-log/thanks`, `/api/call-log/submit`** (Gideonův Firewall, public form pro vzkazy)
- **`/me/*`, `/api/me/*`** (Studna host links, autorizace přes `guestToken` v URL)
- `/_astro/*` (static assets)

**Apex → www redirect** (`apexRedirect()` v middleware) — `raseliniste.cz/*` → 301 → `www.raseliniste.cz/*`. Cookies a passkey jsou vázané na hostname, takže nemůže existovat dva paralelní login states.

---

## Gemini modely

V `src/lib/gemini.ts`:

```ts
export const DEFAULT_MODEL = "gemini-2.5-flash";   // default, rychlý, levný
export const FAST_MODEL = "gemini-2.5-flash";      // alias (= default)
export const ANALYSIS_MODEL = "gemini-2.5-pro";    // analýzy
```

Kde co:

| Použití | Model | Lib |
|---|---|---|
| Capture klasifikace | Flash | `src/lib/classifier.ts` |
| Journal AI redakce (učesání + hashtagy) | Flash | `src/lib/journal-redact.ts` |
| Health analýza (manual + měsíční cron) | **Pro** | `src/lib/health-analyze.ts` |
| Letter „Učesat" | Flash | `src/lib/letter-redact.ts` |
| AI chat | Flash | `src/pages/api/ai/chat.ts` |

Flash = primary. Pro jen tam, kde kvalita > rychlost a cena (zdravotní analýza je zásadní, za pár haléřů stojí).

### Vertex AI vs. AI Studio (dual-mode)

`getGemini()` kontroluje env:

1. **`VERTEX_PROJECT` vyplněno** → klient běží na **Vertex AI**
   - Region z `VERTEX_LOCATION` (default `europe-west1`)
   - Autentizace z `GOOGLE_APPLICATION_CREDENTIALS` (cesta k service-account JSON, namountovaná do kontejneru z `/volume1/docker/raseliniste/gcp-key.json`)
   - **Doporučeno pro produkci** — EU data residency, žádné trénování na promptech, GCP DPA

2. **Jinak** → fallback na `GEMINI_API_KEY` (Google AI Studio)

Při startu Node loguje použitý mód:
```
[gemini] Vertex AI mode — project=raseliniste-ai location=europe-west1
[gemini] AI Studio API key mode (fallback — doporučeno přejít na Vertex)
```

`GET /api/health/ai` (auth: session) — vrátí `{ mode, ok, elapsedMs, sample }`, dělá test prompt přes `getGemini()`.

---

## API reference

Všechny endpointy: `export const prerender = false`, JSON payload, zod validace.

### Auth
| Method | Path | Auth | Popis |
|---|---|---|---|
| POST | `/api/auth/login` | — | password → preauth cookie |
| POST | `/api/auth/logout` | session | destroy session |
| GET | `/api/auth/me` | session | current user info |
| POST | `/api/auth/passkey/register-options` | preauth | WebAuthn register challenge |
| POST | `/api/auth/passkey/register-verify` | preauth | verify & save credential → session |
| POST | `/api/auth/passkey/auth-options` | preauth | WebAuthn auth challenge |
| POST | `/api/auth/passkey/auth-verify` | preauth | verify assertion → session |

### Tokens
| Method | Path | Auth | Body | Poznámka |
|---|---|---|---|---|
| GET | `/api/tokens` | session | — | |
| POST | `/api/tokens` | session | `{name}` | Plain token vrácen **jen jednou** |
| DELETE | `/api/tokens/:id` | session | — | Soft-delete (`revokedAt`) |

### Settings
| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/api/settings/reports` | session | — |
| PATCH | `/api/settings/reports` | session | `{notificationEmail}` |

### Capture
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/ingest` | Bearer / session | `{text, source}` |
| GET | `/api/triage` | session | — |
| PATCH | `/api/entries/:id` | session | `{text?, type?, suggestedProject?, suggestedWhen?, knowledgeCategory?, knowledgeUrl?, knowledgeTags?, status?}` |

Rate limit `/api/ingest`: **100 / 24 h** per user.

### Journal
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/api/journal/ingest` | Bearer / x-api-key / session | `{text, source?, location?, skipRedact?}` |
| GET | `/api/journal/entries` | session | `?q&tag&from&to&limit&offset` |
| POST | `/api/journal/entries` | session | `{text, redact?, location?}` |
| GET | `/api/journal/tags` | session | — (vrací `[{tag, count}]` desc) |
| PATCH | `/api/journal/entries/:id` | session | `{text}` |
| DELETE | `/api/journal/entries/:id` | session | — (soft delete) |

Rate limit `/api/journal/ingest`: **200 / 24 h** per user.

### Health
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/api/health-ingest` | x-api-key / Bearer | HAE JSON payload |
| GET | `/api/health/summary` | session | `?from&to` |
| POST | `/api/health/analyze` | session | `{from, to, focus?}` |
| GET | `/api/health/analyses` | session | `?limit` |
| GET | `/api/health/analyses/:id` | session | — |
| DELETE | `/api/health/analyses/:id` | session | — |

Rate limit `/api/health/analyze`: **10 / 24 h** per user (Gemini Pro guard).

### Tasks
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/tasks` | session | `?includeCompleted=1` |
| PATCH | `/api/tasks/:id` | session | `{completed: boolean}` |
| DELETE | `/api/tasks/:id` | session | — |
| POST | `/api/tasks/:id/todoist` | session | — (push do Todoistu, idempotent) |

### Notes
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/notes` | session | `?q&type&category&tag&includeCompleted=1` (vrací i `categories[]`, `tags[]`) |
| PATCH | `/api/notes/:id` | session | `{completed: boolean}` |
| DELETE | `/api/notes/:id` | session | — |

### Contacts (Firewall kontakty)
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/contacts` | session | `?q&vip=1` |
| POST | `/api/contacts` | session | `{displayName, firstName?, lastName?, isVip?, phones[], emails[]}` |
| PATCH | `/api/contacts/:id` | session | (partial update, replaces phones/emails arrays) |
| DELETE | `/api/contacts/:id` | session | — |
| POST | `/api/contacts/import` | session / multipart | vCard `file` nebo `{text}` + `?offset&limit` chunked (default 50) |

### Call Log (Gideonův Firewall)
| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/call-log` | **public** | (HTML formulář) |
| POST | `/api/call-log/submit` | **public** | `{phone, message, isUrgent?, website (honeypot)}` |
| GET | `/api/call-log` | session | `?unseen=1` (historie pro `/firewall`) |
| PATCH | `/api/call-log/:id` | session | `{seen: boolean}` |
| GET | `/api/call-log/by-token` | **public** | `?t=<callLogToken>&days=14` — VIP výpis vlastních misí (otevřené + hotové N dní); on-demand Todoist sync pokud > 5 min; bez tokenu nelze získat seznam |
| GET, POST | `/api/contacts/:id/call-log-token` | session | GET vrátí (a auto-vygeneruje) token pro VIP kontakt; POST vždy regeneruje (zruší předchozí link) |
| POST | `/api/cron/todoist-sync` | **x-cron-key** | každých 5 min; pull změn z Todoistu → Task/CallLog (status sync + nové úkoly + projekty do `TodoistProjectMirror` pro UI mapování) |
| POST | `/api/cron/scheduler` | **x-cron-key** | každých 5 min; JEDINÝ DSM entry — interně dispatchuje 16 úloh dle `cron-schedule.ts`; `?dryRun=1` |
| GET | `/api/cron/scheduler` | public | seznam definic (bez stavů, žádný leak) |
| GET | `/api/cron/status` | session | přehled posledních runů — pro Dashboard / `/start` / `/settings/crons` |

Rate limit `/api/call-log/submit`: **5 / 10 min per IP**.

### Integrations (Todoist + SMTP)
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/integrations/todoist` | session | `{token}` (testne přes `testConnection`, pak šifrovaně uloží) |
| DELETE | `/api/integrations/todoist` | session | — |
| GET | `/api/integrations/todoist/projects` | session | — (paginovaný list z Todoist v1 API) |
| PATCH | `/api/integrations/todoist/config` | session | `{vyruseni?, vip?, mojeUkoly?}` (project IDs) |
| POST | `/api/integrations/todoist/test` | session | — (verify connection) |
| GET | `/api/settings/mail` | session | — |
| POST | `/api/settings/mail` | session | `{host, port, secure, user, password, from}` (verify + save) |
| DELETE | `/api/settings/mail` | session | — |
| POST | `/api/settings/mail/test` | session | `{to}` (pošle test mail) |

### Letters
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/letters/senders` | session | — |
| POST | `/api/letters/senders` | session | `{name, ...optional fields}` |
| PATCH | `/api/letters/senders/:id` | session | (partial) |
| DELETE | `/api/letters/senders/:id` | session | — (smaže i logo/podpis z disku) |
| POST | `/api/letters/senders/:id/upload` | session / multipart | `kind=logo\|signature, file` |
| DELETE | `/api/letters/senders/:id/upload` | session | `{kind}` |
| GET | `/api/letters/recipients` | session | `?q` |
| POST | `/api/letters/recipients` | session | `{name, addressLines?}` |
| PATCH/DELETE | `/api/letters/recipients/:id` | session | — |
| GET | `/api/letters` | session | `?q&senderId` |
| POST | `/api/letters` | session | `{senderId, recipientId? \| recipientName+addressLines, bodyRaw, ...}` |
| GET | `/api/letters/:id` | session | — (vrací i `versions[]`) |
| PATCH | `/api/letters/:id` | session | (partial) — invaliduje PDF cache |
| DELETE | `/api/letters/:id` | session | — |
| POST | `/api/letters/:id/redact` | session | `{bodyRaw?, promptOverride?}` (Gemini „Učesat") |
| POST | `/api/letters/:id/regenerate` | session | — (vytvoří novou verzi, parent zůstane) |
| GET | `/api/letters/:id/pdf` | session | `?download=1` (cache na disk, invalidace při změně) |

### Uploads
| Method | Path | Auth | Popis |
|---|---|---|---|
| GET | `/api/uploads/[...path]` | session | servíruje disk soubor s ownership check (path-traversal blokovaný) |

### Health checks
| Method | Path | Auth | Popis |
|---|---|---|---|
| GET | `/api/health/ai` | session | mode + test prompt přes `getGemini()` |

### Studna
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/studna` | session | — (list projektů s _count) |
| POST | `/api/studna` | session | `{name, homeTitle?, description?, extractionPrompt?}` |
| GET | `/api/studna/:id` | session | — (detail s invitations + recordings + summaries) |
| PATCH | `/api/studna/:id` | session | (partial update + `archive: bool`) |
| DELETE | `/api/studna/:id` | session | — |
| POST | `/api/studna/:id/invite` | session | `{name, email, phone?, canRecordBrief?}` (vrací invite link) |
| PATCH | `/api/studna/:id/invitations/:guestId` | session | `{canRecordBrief}` |
| DELETE | `/api/studna/:id/invitations/:guestId` | session | — |
| POST | `/api/studna/:id/recording` | session | multipart audio (owner-only) |
| POST | `/api/studna/:id/summary` | session | — (Gemini Pro nad všemi recordings) |
| PATCH | `/api/studna/recordings/:id` | session | `{isPinned}` |
| DELETE | `/api/studna/recordings/:id` | session | — |
| GET | `/api/studna/recordings/:id/audio` | session | — (stream MP3/WebM pro přehrávač) |
| GET | `/api/studna/:id/onboarding/:guestId/standard.pdf` | session | — (onboarding PDF pro běžné contributory) |
| GET | `/api/studna/:id/onboarding/:guestId/brief.pdf` | session | — (onboarding PDF pro brief contributory) |
| GET | `/api/me/:token` | **public** | seznam projektů hosta |
| POST | `/api/me/:token/recording` | **public** | multipart audio (rate-limit 20/h/host) |

### Calendar (fáze 1a)
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| GET | `/api/calendar/events` | session | `?from&to` (ISO date overlapping window) |
| GET | `/api/integrations/google` | session | — (status + stats: events, contacts) |
| POST | `/api/integrations/google` | session | — (start OAuth, vrátí `{url, state}`) |
| DELETE | `/api/integrations/google` | session | — (disconnect + revoke) |
| GET | `/api/integrations/google/callback` | session + state cookie | `?code&state` (Google → naše app) |
| POST | `/api/integrations/google/sync` | session | `{what: "calendar"\|"contacts"\|"all"}` |

### Cron
| Method | Path | Auth | Query |
|---|---|---|---|
| POST | `/api/cron/monthly-health-report` | **x-cron-key** | `?from&to` (override; jinak předchozí celý měsíc) |
| POST | `/api/cron/anniversary-reminders` | **x-cron-key** | — (denně 7:05; pošle email/WhatsApp pokud dnes + reminderDaysBefore = výročí/narozeniny) |
| POST | `/api/cron/zijes-reminder` | **x-cron-key** | `?type=lunch\|evening` (denně 13:00 a 18:00; ŽIJEŠ? check-in připomínka) |
| POST | `/api/cron/bwmys-tick` | **x-cron-key** | denně 7:10; B&W Myš auto-návrat odložených + deadline/sber/revize notifikace |
| GET/POST | `/api/bwmys` | session | List rozhodnutí (?status=, ?archive=1), vytvořit nové |
| GET/PATCH/DELETE | `/api/bwmys/:id` | session | Detail s entries+evals+reopenings, edit zarámování, kaskádové smazání |
| POST | `/api/bwmys/:id/entry` | session | Text zápis (Tok 2), validace + warnings o deadline/sběr |
| POST | `/api/bwmys/:id/entry-audio` | session/multipart | Audio → Stage 1 přepis + Stage 2 AI extrakce metadat → Entry |
| POST | `/api/bwmys/:id/reopen` | session | Tok 6 znovuotevření, povinný popisNovehoFaktu + schvaleno=true |
| POST | `/api/bwmys/:id/evaluate` | session | Mini (3+) / finální (5+ s lowSample warning), AI sekce A-H, pre-klasifikace úhlů |
| POST | `/api/bwmys/suggest-variants` | session | AI návrh dalších 2-3 variant při zakládání |
| GET | `/api/bwmys/:id/export` | session | Markdown export celého rozhodnutí |
| POST | `/api/bwmys/:id/arguments` | session | Extrakce mřížky argumentů (cache do `argumentsJson`, `?force=1` regenerace) |
| GET | `/api/push/subscribe` | session | Vrátí VAPID public key + seznam aktivních subscriptions |
| POST | `/api/push/subscribe` | session | Uloží novou subscription (klientský PushSubscription objekt) |
| PUT | `/api/push/subscribe` | session | Pošli test push na všechna zařízení usera |
| DELETE | `/api/push/subscribe?id=X` | session | Smaž konkrétní subscription |
| GET/POST | `/api/zijes` | session | List/vytvoř check-in záznam |
| GET/POST | `/api/vyroci` | session | List/vytvoř výročí |
| PATCH/DELETE | `/api/vyroci/:id` | session | Upravit/smazat |
| POST | `/api/cron/anniversary-reminders` | **x-cron-key** | denně 7:05; pošle email/push/WA pokud dnes + reminderDaysBefore = výročí/narozeniny |
| POST | `/api/cron/daily-projects-digest` | **x-cron-key** | `?date=YYYY-MM-DD` (override celého toho dne; jinak posledních 24 h) |
| POST | `/api/cron/cleanup-audio` | **x-cron-key** | — (smaže STANDARD audio >14d, pokud není pinned) |
| POST | `/api/cron/sync-calendars` | **x-cron-key** | — (Google primary, à 5 min) |
| POST | `/api/cron/sync-contacts` | **x-cron-key** | — (Google People, denně 04:00) |

### AI
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/ai/chat` | session | `{prompt, fast?}` |

---

## Design system

### Token layer (v `src/styles/global.css`)

Shadcn-style CSS proměnné s OKLCH, mapovány do Tailwind v4 přes `@theme inline`:

```
--background     oklch(14% 0.025 260)   hluboká půlnoční modř
--foreground     oklch(98% 0.01 240)    téměř bílý text
--card           oklch(100% 0 0 / 0.045)  glass card wash
--primary        oklch(82% 0.12 45)     peach (CTA)
```

Pastelové tinty:

| Tint | Modul |
|---|---|
| peach | Úkoly / TASK / Capture Shortcut |
| mint | Poznámky |
| lavender | Kontakty / THOUGHT |
| sky | Kalendář / CONTEXT |
| sage | Finance / success |
| butter | **Deník / JOURNAL / warning** |
| rose | AI / Zdraví / error |
| pink | Soubory |

### Glass utility

Tři úrovně:
- `.glass-subtle` — blur 12 px, 2.5 % white
- `.glass` — blur 24 px, 4.5 % white (default karta)
- `.glass-strong` — blur 32 px, 8 % white (modal/login)

### Typografie
- **Fraunces** (variabilní serif) pro h1/h2/h3 a dekorativní nadpisy
- **Geist** sans pro body
- **Geist Mono** pro datumy, ID, metadata
- Base font-size 15.5 px, letter-spacing -0.015em u nadpisů

### Ikony

**Lucide** všude. Astro: `<Icon name="lucide:check-square" />` (`astro-icon` + `@iconify-json/lucide`). React: `import { Check } from "lucide-react"`.

### Responsive
- Desktop: sidebar 260 px + main
- Mobile (< `lg`): sidebar off-canvas + menu button v topbaru (`SidebarToggle` React island)

### Pravidla
1. **Kontrast je must** (Petr starší). Foreground 98 %, muted 78 %, minimum 70 %.
2. **Každý modul má svůj tint**. Konzistence pomáhá orientaci.
3. **Fraunces jen pro dekorativní nadpisy, ne pro data**. Čísla a tabulky v Geist/Mono.
4. **Glass jen na top-level containery**. Uvnitř karty clean Tailwind.
5. **Data hustá, dekorace skromná**.

---

## Vývojový workflow

### Scripty

```bash
npm run dev              # Astro dev
npm run build            # produkční build do dist/
npm run preview          # náhled produkčního buildu
npm run start            # spustí node ./dist/server/entry.mjs

npm run db:migrate       # prisma migrate dev
npm run db:generate      # prisma generate
npm run db:seed          # vytvoří admin user z env
npm run db:studio        # Prisma Studio GUI

npm run health:import -- <path> [username]
                         # jednorázový import HAE JSON
```

### Přidání nové migrace

```bash
# 1. uprav prisma/schema.prisma
# 2. npm run db:migrate  (promptne na název)
# 3. npm run db:generate (regen TS typy)
# 4. Restart dev serveru
```

Produkce: entrypoint automaticky volá `prisma migrate deploy` před startem.

### Přidání nového modulu (šablona)

1. **Prisma** — doplň model + migrace
2. **lib/** — logika nezávislá na frameworku (`src/lib/yourmodule.ts`)
3. **API** — endpointy v `src/pages/api/yourmodule/...ts` (vždy `prerender = false` + zod body + `readSession(cookies)`)
4. **UI** — stránka v `src/pages/yourmodule.astro` obalena `<Shell>`, interaktivita v React islandech v `src/components/`
5. **Sidebar** — v `src/layouts/Shell.astro` přepni modul na `enabled: true`
6. **Smoke test** — curl + manual browser flow

### Env vars

| Proměnná | Dev | Produkce |
|---|---|---|
| `DATABASE_URL` | `postgresql://raseliniste:devpassword_local_only@localhost:5433/raseliniste` | `postgresql://raseliniste:${DB_PASSWORD}@postgres:5432/raseliniste` |
| `SESSION_SECRET` | dev string ≥32 znaků | `openssl rand -base64 48` |
| `APP_URL` | `http://localhost:3000` | `https://www.raseliniste.cz` |
| `GEMINI_API_KEY` | z AI Studio | stejný |
| `NODE_ENV` | `development` | `production` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | jen pro `db:seed` | jen pro první seed na NASu |
| `RESEND_API_KEY` | (volitelně) | aktivuje email odesílání |
| `NOTIFICATION_FROM` | (volitelně) | odesílatel mailů (z Resend ověřené domény) |
| `NOTIFICATION_EMAIL` | (volitelně) | default příjemce (override uživatelem v /settings/reports) |
| `CRON_SECRET` | (volitelně) | shared secret pro `x-cron-key` |

**Nikdy necommituj** `.env.local`, `.env`. `env.example` je šablona.

---

## Deploy na Synology

Plný postup v `SYNOLOGY_DEPLOY_PATTERN.md`. Zkráceně:

1. **GitHub repo** (private OK). Push na `main` → GitHub Actions build → image `ghcr.io/<user>/<repo>/app:latest`.
2. **Image public** — ghcr.io Package → Change visibility → Public.
3. **DNS**: `A www.raseliniste.cz → IP NASu`.
4. **Router**: port forward 80 + 443.
5. **DSM Certificate**: Let's Encrypt pro doménu.
6. **DSM Reverse Proxy**: `https://www.raseliniste.cz:443` → `http://localhost:3333`.
7. **DSM Web Station**: smaž „Výchozí server" (zabírá 443).
8. **DSM Container Manager → Project**:
   - Create `raseliniste`
   - Upload `docker-compose.yml`
   - Create `.env` vedle něj (vše z `.env.example` vyplň)
   - Build → Start
9. **První seed**: Container `raseliniste_app` → Terminal → `npm run db:seed`.
10. Browser: `https://www.raseliniste.cz/login` → přihlas se (heslo z `ADMIN_PASSWORD`) → **enrollni nový passkey** (produkční doména) → v `/settings/tokens` vytvoř tokeny → v `/settings/reports` nastav email.

**Důležité pro WebAuthn**: `APP_URL` v produkčním `.env` MUSÍ být `https://www.raseliniste.cz`. Passkey je vázaný na hostname — lokální passkey v produkci neprojde.

**Update flow**: git push → Actions buildnou → na NASu: Container Manager → Image → Pull latest → Project → Restart.

---

## Email (Resend)

Bez tohoto kroku se maily neodesílají (systém jen loguje do konzole, nic jinak nepadá).

1. Registrace na `resend.com` (zdarma 3 000 mailů / měsíc).
2. **Domains → Add Domain** → `raseliniste.cz`.
3. Resend ukáže **TXT (SPF, DKIM) + MX** záznamy. Přidej je u registrátora (Forpsi / kdokoli).
4. Počkej na ověření (10-30 min).
5. **API Keys → Create** → zkopíruj → do `.env` jako `RESEND_API_KEY`.
6. `NOTIFICATION_FROM=reports@raseliniste.cz` (nebo jiná adresa na ověřené doméně).
7. `NOTIFICATION_EMAIL=<tvoje soukromá adresa>` (nebo ji nech prázdnou a nastav v `/settings/reports`).
8. Restart kontejneru.

**Hierarchie příjemce** (v cron endpointu):
1. `User.notificationEmail` (z `/settings/reports`) — per-user override
2. `env.NOTIFICATION_EMAIL` — globální default
3. Pokud ani jedno → mail se neodešle, analýza se stále uloží do archivu

---

## Cron na Synology

### Měsíční health report

1. **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**
2. **Schedule**: Monthly, Last day, 23:00
3. **Run command**:
   ```bash
   curl -fsS -X POST https://www.raseliniste.cz/api/cron/monthly-health-report \
        -H "x-cron-key: <CRON_SECRET>" \
        --max-time 120
   ```
4. Test: pravý klik na task → **Run**
5. Ověření: `/health` → Uložené analýzy → nová s badge „měsíční"

### Backfill (retro-analyzovat starší měsíc)

```bash
curl -X POST "https://www.raseliniste.cz/api/cron/monthly-health-report?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z" \
     -H "x-cron-key: $CRON_SECRET"
```

---

## iPhone Shortcuty a HAE

V aplikaci si postavíš tři integrace (návody jsou v aplikaci Rašeliniště přímo):

### 1. Capture Shortcut
- `/settings/shortcuts` → karta **Rasel Capture** (peach)
- Obecný diktát → Gemini klasifikuje → triage
- Endpoint: `POST /api/ingest`, header `Authorization: Bearer <TOKEN>`

### 2. Deník Shortcut
- `/settings/shortcuts` → karta **Rasel Deník** (butter)
- **Přímý zápis do deníku** — bez klasifikace, rovnou CONFIRMED
- **Volitelně** `Get Current Location` → lokace se zapíše do `/journal` jako MapPin badge
- Endpoint: `POST /api/journal/ingest`, header `x-api-key: <TOKEN>`

### 3. Health Auto Export
- `/settings/ingest` — kompletní 6-krokový návod
- Aplikace HAE (Premium, ~3 €/měs) → REST API → POST na `/api/health-ingest`
- Frequency: Daily, aggregation: Daily
- Header `x-api-key: <TOKEN>`

Všechny 3 používají stejný typ **API tokenu** (z `/settings/tokens`). Můžeš mít 1 univerzální nebo 3 separátní (doporučuju separátní — snadno revokuješ jen jeden).

---

## Provoz a troubleshooting

### Backup databáze

```bash
docker exec raseliniste_db pg_dump -U raseliniste raseliniste | gzip > /volume1/backup/rasel-$(date +%F).sql.gz
```

DSM Task Scheduler, denně v noci. Obnova:

```bash
gunzip -c rasel-2026-04-20.sql.gz | docker exec -i raseliniste_db psql -U raseliniste -d raseliniste
```

### Časté problémy

**EACCES na volume.** Entrypoint to řeší sám (`chown -R 1001:1001 /data`). Pokud ne, Docker volume byl vytvořený jako root. Container Manager → Project → Clear → znovu Start.

**P3009 failed migrations.** `scripts/heal-migrations.mjs` se pouští v entrypointu před `migrate deploy` — maže stuck rows. Pokud to nestačí, v terminálu: `npm run db:studio`, najdi `_prisma_migrations`, smaž selhanou migraci.

**`Cannot read properties of undefined (reading 'createMany')`.** Dev server drží starý Prisma client. Kill dev, `npx prisma generate`, restart.

**WebAuthn selže na produkci po deploy.** `rpID` musí odpovídat hostname v `APP_URL`. Passkey z `localhost` nefunguje na `raseliniste.cz`. Po deploy enrollni nový.

**Gemini `429 RESOURCE_EXHAUSTED`.** Free tier má denní limit. Studio → Billing → paid (pro single user v praxi unlimited).

**Port 3000 zabraný.** Lokální dev 3000, NAS 3333. Změň dev port: `astro dev -p 3333`.

**`Cross-site POST form submissions are forbidden`** z curl. Astro `security.checkOrigin`. Pošli `Content-Type: application/json` nebo `-H "Origin: http://localhost:3000"`.

**Maily se neposílají.** Zkontroluj `RESEND_API_KEY` + `NOTIFICATION_FROM`. V dev mailer jen loguje (`[mailer] ...`), ne odesílá. V `/settings/reports` status card ti řekne, co chybí.

**Cron endpoint vrací 503 CRON_NOT_CONFIGURED.** `CRON_SECRET` není v env.

**Cron endpoint vrací 401 UNAUTHORIZED.** Špatný `x-cron-key` header (překlep, nebo se neshoduje s env).

### Diagnostika

- **Logy**: Container Manager → Logs, nebo `docker logs raseliniste_app -f`
- **DB shell**: `docker exec -it raseliniste_db psql -U raseliniste -d raseliniste`
- **Prisma Studio** (jen lokálně): `npm run db:studio` → http://localhost:5555
- **Health check**: `GET /api/auth/me` — rychlá sanity kontrola že server + DB + session běží

---

## Roadmap

### ✅ Hotovo (do 28. 4. 2026)

- Todoist dispatch (auto-push při Triage confirm + manuální v `/tasks`)
- Úkoly `/tasks`, Poznámky `/notes`, Kontakty `/contacts` (vCard + Google sync)
- Gideonův Firewall (`/call-log` + admin)
- Dopisy `/letters` (2 PDF témata, „Učesat" AI, verzování)
- E-mail SMTP UI (Seznam/Gmail/Outlook presety)
- Vertex AI dual-mode (EU residency)
- Studna `/studna` (sdílené projektové boxíky s audio + AI rozborem)
- **Kalendář fáze 1a** — Google Calendar + Contacts sync, `/calendar` UI, `/settings/integrations/google`

### 🚧 Rozpracováno

**Kalendář fáze 1b/2/3/4** — postupně dotahujeme podle briefu (`raseliniste-kalendar-brief.md`):

- **1b**: iCloud CalDAV sync (syn + partnerka) + pravidlový engine + `/quickadd` parser
- **2**: Bookingy (`/calendar/invite`, `/i/<token>`, `/schuzka` cold lead) + magic-link
- **3**: DayNote UI + Briefing 22:00 → Todoist + Capture integrace pro time-binding
- **4**: OOO management, Locations admin, PWA polish

### 🟡 P-1 (následující)

1. **Úkoly UX** — kalendářní pohled, inline edit textu, drag mezi sekcemi, due date picker
2. **Tasks pull-sync z Todoistu** — odškrtnutí v TD se promítne do `/tasks`
3. **„Co vzít s sebou"** — bude součástí fáze 3 (briefing 22:00 to nahradí)

### 🟢 P-2 (UX vylepšení, časem)

5. **Dashboard widgety** — KPI pro Studna, Tasks pending, Firewall unread
6. **Per-projekt ikona Studny** — vlastní logo per projekt + dynamický apple-touch-icon
7. **Backup automatizace** — nightly pg_dump → druhý NAS / Backblaze B2

### 🔵 P-3 (nice-to-have)

8. Capture iPhone Shortcut (návod existuje, dořešit reference shortcut JSON)
9. Push notifikace pro VIP firewall (Web Push nebo Telegram bot)
10. AI chat nad vlastními daty (RAG nad Recordings + Entries + Health)
11. Health detaily — klikneš na KPI kartu → detail analýza jen té metriky

### ⚪ P-4 (později)

12. Modul **Soubory** — upload + organizace dokumentů
13. **Plaud** integrace (audio diktafon)
14. **Superlist** integrace
15. **Claude kouč** — projektová integrace na Anthropic projekt

---

## Příspěvkový guide (pro Claude Code i lidi)

- **Odpovídej česky, stručně.** Přímá komunikace bez vaty.
- **Neprogramuj dopředu.** Nepřidávej abstrakce/features, které si Gideon neřekl.
- **Před riskantními akcemi se ptej** — `git push --force`, `rm -rf`, drop DB, změny v `prisma/migrations/`.
- **Mobilní UX** — testuj na telefonu hned po větší layoutové změně.
- **Gemini klíč** NIKDY do client bundle. Vždy přes `/api/ai/*` proxy.
- **Každý modul = pastelový tint.** Konzistence napříč sidebar/KPI/badge.
- **Maximum bezpečnosti** — argon2, rate-limit, konstantní čas, ownership check, status transitions. Neřezat.

---

*Stav ke dni 2026-04-20: Auth + Capture + Deník + Zdraví + Settings + Cron hotové a lokálně otestované. Připraveno k prvnímu deployi na Synology.*

# === Aktualizace 2026-04-29 — kompletní stav ===

> Tato sekce je konsolidovaná aktualizace všeho, co přibylo / změnilo se od 2026-04-20. Detail výše v dokumentu může být zastaralý — tato sekce má přednost.

## Aktuální stav modulů (2026-04-29)

| Modul | Status | URL | Poznámka |
|---|---|---|---|
| Auth (heslo + passkey) | ✅ hotovo | `/login` | sameSite: lax (kvůli OAuth) |
| Capture | ✅ hotovo | `/capture`, `/triage` | Entry-based |
| Capture inbox | ✅ hotovo | `/tasks` | legacy z Capture flow, zachováno |
| **Úkoly (samostatný Task model)** | ✅ **NOVÉ** | `/ukoly` | manuální + delegace + Todoist push (Lidé/sekce smart routing) |
| Poznámky | ✅ hotovo | `/notes` | |
| **Deník (samostatný JournalEntry)** | ✅ **NOVÉ** | `/denik` | hlasový + textový + měsíční review |
| Deník (legacy) | ✅ hotovo | `/journal` | Capture-based, zachováno |
| **Ozvěna — sjednocený diktát** | ✅ **NOVÉ** | `/ozvena` | přepínač Úkoly / Deník, PWA |
| Zdraví | ✅ hotovo | `/health` | |
| Kontakty | ✅ hotovo | `/contacts` | vCard + Google sync |
| Gideonův Firewall | ✅ hotovo | `/call-log`, `/firewall` | |
| Dopisy | ✅ hotovo | `/letters` | |
| Studna | ✅ hotovo | `/studna` | + inline recorder v detailu projektu, two-stage AI pipeline, fire-and-forget Promise pinning |
| **Kalendář (kompletní)** | ✅ **dokončeno** | `/calendar` | 1a+1b+2+3+4 (Google + iCloud + Rules + Quickadd + Bookingy + Briefing + OOO + Locations) |
| **AI usage tracking** | ✅ **NOVÉ** | `/settings/ai-usage` | Recharts dashboard, per modul/model/den |
| **AI prompty editor** | ✅ **NOVÉ** | `/settings/ai-prompts` | 7 editovatelných promptů |
| **Diagnostika Studny** | ✅ **NOVÉ** | `/api/diagnose/studna` | komplexní health check pro debug |

## Nové datové modely

```prisma
// Úkoly (samostatný od Entry)
model Task {
  id, userId, title, notes, dueAt, dueIsTime, tags[], status, priority,
  assignedToContactId (FK Contact), source (manual/audio/quickadd/capture),
  sourceBatchId (FK TaskAudioBatch), rawSnippet,
  todoistTaskId, todoistProjectId, pushedAt, pushError, completedAt
}

model TaskAudioBatch {
  id, userId, audio*, rawTranscript, proposalsJson, status, processingError
}

// Deník (samostatný od Entry)
model JournalEntry {
  id, userId, date, title, bodyMarkdown, rawTranscript, mood (enum),
  tags[], people[] (z hlavičky LIDÉ pro vyhledávání), highlights[],
  audio*, audioRetainForever, status, processingError
}

// AI tracking
model AiUsageLog {
  id, at, userId?, module, model, mode, inputTokens, outputTokens,
  costUsd, costCzk, durationMs, success, errorMsg
}

model AiPrompt {
  id, module unique, content, updatedAt
  // Override defaultů z lib/ai-prompts.ts DEFAULT_PROMPTS
}
```

## Cron úlohy (11 celkem) — kompletní seznam

Detail v `Návody/03-crony.pdf`. Krátký výpis:

| # | Endpoint | Schedule |
|---|---|---|
| 1 | sync-calendars | každých 5 min |
| 2 | sync-contacts | denně 04:00 |
| 3 | nightly-briefing | denně 22:00 |
| 4 | retry-stuck-recordings (Studna) | každých 15 min |
| 5 | cleanup-audio (Studna) | denně 03:00 |
| 6 | daily-projects-digest (Studna) | denně **7:00 ráno** (okno posledních 24 h) |
| 7 | monthly-health-report | poslední den měsíce 23:00 |
| 8 | cleanup-expired-invites (Bookingy) | denně 01:00 |
| 9 | cleanup-task-audio-batches | denně 02:30 |
| 10 | retry-stuck-task-batches | každých 5 min |
| 11 | cleanup-journal-audio | denně 03:15 |
| 12 | **anniversary-reminders** | denně **7:05 ráno** (email + WhatsApp upozornění na výročí a narozeniny kontaktů) |
| 13 | **zijes-reminder ?type=lunch** | denně **13:00** (ŽIJEŠ? polední check-in, neutrální tón) |
| 14 | **zijes-reminder ?type=evening** | denně **18:00** (ŽIJEŠ? večerní check-in, neutrální tón) |
| 15 | **bwmys-tick** | denně **7:10** (B&W Myš — auto-návrat odložených, deadline alert 3d, sběr uplynul, datum revize) |
| 16 | **todoist-sync** | každých **5 min** (pull změn z Todoistu — completion → Task.completedAt + CallLog.seenAt; nové úkoly v Todoist appce → Task se source=todoist_pull; per-user incremental přes Sync API a `User.todoistSyncToken`) |

### Cron scheduler (NOVÉ 2026-05-02) — 1 DSM entry místo 16

DSM Task Scheduler obsahuje **jeden** entry — `POST /api/cron/scheduler` každých 5 min. Dispatcher (`src/lib/cron-dispatcher.ts`) pak interně dle rozvrhu (`src/lib/cron-schedule.ts`) volá příslušné endpointy `/api/cron/<name>` přes localhost s x-cron-key.

- **Idempotence:** `CronRun` tabulka per-job, kontrola `lastSuccessAt` proti aktuálnímu oknu (denní = dnes, every:Nmin = před více než N min).
- **Tolerance:** scheduler běží každých 5 min → daily HH:MM má toleranci ±2.5 min.
- **Fire-and-forget:** `nightly-briefing` a `monthly-health-report` se spouští bez čekání (long-running ~120 s); status se update-ne v background.
- **Stav:** `GET /api/cron/status` (auth session) vrátí přehled posledních runů. UI `/settings/crons` má tabulku, dlaždice na Dashboard + řádek na `/start`.
- **Manuální spuštění:** každý job má stále vlastní endpoint `/api/cron/<name>` (POST s x-cron-key) pro debug a fallback.
- **Dry-run:** `POST /api/cron/scheduler?dryRun=1` vrátí co BY se spustilo, nic neexecutuje.

## Důležité architektonické změny

### Fire-and-forget Promise pinning (commit 2f32fac)

Astro/Node garbage-collectoval Promises po vrácení Response. Audio AI processing se ztrácel. **Řešení:** module-level `Set<InFlight>` v `process-recording.ts`, `process-task-audio.ts`, `process-journal-audio.ts`. Reference se drží dokud Promise neresolvne.

Diagnostika: `/api/diagnose/studna` ukazuje aktuální in-flight processings + stuck recordings + audio na disku check.

### Two-stage audio pipeline (commit 7d1cb88)

Předtím: Gemini JSON output mode pro audio = nespolehlivý (občas chybí pole `transcript`).

Nyní:
- **Stage 1:** Flash plain-text přepis (žádný JSON, vysoká spolehlivost)
- **Stage 2:** Pro/Flash JSON analýza nad přepisem (žádné audio v requestu)

Garantujeme: i když Stage 2 selže, transcript je vždy uložený. Pokrývá retries (3× exp backoff).

### Vertex / AI Studio fallback pro velké audio (commit 1dc1039)

Vertex AI nepodporuje `genai.files.upload()` (Files API existuje jen v Google AI Studio). Pro audio > 14 MB v Vertex módu fallback na AI Studio Files API přes `GEMINI_API_KEY`.

### AI prompts override system (commit 00086dd)

Default prompty hardcoded v `lib/ai-prompts.ts` (single source of truth). Override v DB tabulce `AiPrompt`. UI v `/settings/ai-prompts`. 60 s in-memory cache. Reset = smaže DB, vrátí default.

7 editovatelných modulů:
- ozvena-stage1-transcribe
- ozvena-stage2-task
- ozvena-stage2-journal
- denik-monthly-review
- studna-standard
- studna-brief
- briefing-nightly

### Sjednocený `/ozvena` recorder (commit fb07525, přejmenováno v c221871)

Místo separátních `/ukoly/audio` a `/denik/audio` jeden vstup `/ozvena` s přepínačem mód úkoly/deník. PWA manifest `/manifest-ozvena.json`. Stará URL redirected.

### Smart Todoist routing pro delegované úkoly (commit 9f9e8af)

Při push úkolu s `assignedToContact`:
1. Top-level projekt přesně jménem assignee → push tam
2. Projekt „Lidé" → najdi/vytvoř sekci jménem assignee
3. Pokud Lidé neexistuje → vytvoř + sekci
4. Bez assignee → default mojeUkoly

## Bezpečnost (audit 2026-04-29)

Ověřené vrstvy:
- ✅ Argon2id + WebAuthn passkey
- ✅ Session cookie httpOnly + sameSite=lax + secure (production) + JWT validovaný proti DB
- ✅ Rate limity: login (5/15min/user), Capture (100/24h), Journal (200/24h), Health analyze (10/24h), Call-log (5/10min/IP), Studna guest (20/h/host), **Booking reserve (20/h/IP — nově přidáno)**
- ✅ AES-256-GCM šifrování secrets v UserIntegration (token derived from SESSION_SECRET)
- ✅ Path-traversal blokovaný v `lib/uploads.ts`
- ✅ File size cap per modul (50/100/500 MB)
- ✅ HMAC-SHA256 magic-link tokeny (booking confirmation)
- ✅ Honeypot + IP rate limit na public formulářích (/call-log, /schuzka)
- ✅ Origin canonical redirect (apex → www) v middleware
- ✅ Public path whitelist v middleware (auth, /me/<token>, /i/<token>, /schuzka, /call-log, cron endpointy)
- ✅ Cron endpointy chráněné x-cron-key + CRON_SECRET v env
- ✅ Vertex AI = no-training, EU region (europe-west1)
- ✅ Ownership check v každém PATCH/DELETE endpointu

Známé limity (nejde o aktuální chyby):
- `checkOrigin: false` v Astro config (kvůli reverse proxy mismatch). Kompenzováno sameSite=lax + ostatní vrstvy.
- Single-user systém, ale schémata `userId` ready na multi-user (nedoplatek je v UI).

## Komunikace s uživatelem

- **Vždy česky, stručně.**
- **Přezdívka v systému: Gideon.** Jméno „Petr" se zachovává jen v externí komunikaci (mail klientům, dopisy, onboarding PDF pro hosty Studny).
- AI prompty mluví o uživateli jako Gideon.
- Vokativy v UI vyhýbat („Ahoj!" místo „Ahoj Gideone").

---

*Stav 2026-04-29 (commit pushnutý před tímto changelog). Další commity přidávají jen drobnosti.*
