# Architektura — Rašeliniště

> Technická referencí do hloubky. Pro „where do I start" čti `CLAUDE.md`,
> pro stavy modulů čti `INSTRUKCE/03-moduly.md`, pro historický kontext
> jednotlivých rozhodnutí čti `docs/DECISIONS.md`.

## Přehled

Rašeliniště je **single-user osobní informační systém** pro Petra Peřinu
(„Gideon"). Astro 6 SSR aplikace běží jako Docker kontejner na **Synology
NAS DS718+** v Petrově domácí síti. Postgres 16 (s pgvector extension) běží
jako druhý kontejner ve stejném docker-compose.

```
┌─────────────────────────────────────────────────────────────────┐
│ Internet                                                         │
│         │                                                        │
│         ▼ HTTPS (Let's Encrypt)                                 │
│  ┌─────────────────┐                                             │
│  │ DSM Reverse Proxy │  raseliniste.cz → :3333                  │
│  └─────────────────┘                                             │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────┐    ┌──────────────────────────┐  │
│  │ raseliniste_app          │◄──►│ raseliniste_db           │  │
│  │ Astro 6 SSR + Node 22    │    │ pgvector/pgvector:pg16   │  │
│  │ Port 3000 (containeru)   │    │ Port 5432                │  │
│  └──────────────────────────┘    └──────────────────────────┘  │
│         │                                                        │
│         ▼ externí volání                                        │
│  Google APIs (Gmail/Calendar/People/Vertex AI),                 │
│  iCloud CalDAV/CardDAV, Todoist v1, SMTP2GO, Web Push gateways  │
└─────────────────────────────────────────────────────────────────┘
```

### Deploy flow

1. Petr commitne lokálně (Claude přes terminál) → push přes **GitHub Desktop**
2. GitHub Actions build → push image na **ghcr.io** (public image, repo private)
3. Na NASce: DSM Container Manager → manual Pull → Recreate
4. `docker-entrypoint.sh` v kontejneru spustí:
   - `chown` data adresářů
   - `scripts/heal-migrations.mjs` (resolve out-of-sync migrations)
   - `prisma migrate deploy` (apply schema změny)
   - `node ./dist/server/entry.mjs` (start Astro server na :3000)

Detail v `SYNOLOGY_DEPLOY_PATTERN.md`.

## Datový model

Prisma schema (`prisma/schema.prisma`) má ~50 modelů. Hlavní rodiny:

### Auth
- **User** — single-user (jen Gideon), hash hesla (argon2), preference push notifikací
- **Session** — JWT v HTTP-only cookie, 7denní TTL, blacklist na server side
- **WebauthnCredential** — passkey support (rozpracováno)
- **LoginAttempt** — rate limiting (5 fails/15min/email, 20 fails/IP)
- **ApiToken** — Siri Shortcut, call-log webhook, cron secret

### Lidé & komunikace
- **Contact** — kanonická data + Rašeliniště overlay (isVip/aliases/clientTag/isTeam)
- **ContactGroup**, **Phone**, **ContactEmail** — vztah many-to-many
- **CallLog** — záznamy hovorů (Petr má GoSMS webhook + manuální zápisy)
- **Letter** + **LetterSender/Recipient** — naskenované dopisy + OCR

### Kalendář & booking
- **CalendarEvent** — události (iCloud Calendar CalDAV + Google Calendar)
- **BookingInvite** — Petrovi pozvánky na schůzky (token-based public link)
- **SchedulingConfig** — DB-driven booking pravidla (working hours, lead time)
- **CustomRitual**, **DayNote**, **BriefingDigest** — denní rytmus

### Úkoly & deník
- **Task** — propojený s Todoist (obousměrný sync), routing přes Smart Routing
- **TaskAudioBatch** — audio záznam z mobilu → Gemini transkript → AI extract úkolů
- **JournalEntry** + **Entry** — deníkové zápisy + indexed transkripty
- **AiPrompt** — pojmenované prompts pro RAG dotazy

### Studánka (sdílené projekty s hosty)
- **ProjectBox** — agregátor (např. „Stavba Tk")
- **GuestUser**, **ProjectInvitation** — Petrovi pozvaní lidé
- **ProjectRecording**, **ProjectSummary** — audio + AI shrnutí

### Pošta (Email Intelligence)
- **PostaEmbedFailure** + **RagChunk** — embedded chunks pro semantic search
- **EncryptionKey** — per-user AES-256-GCM key (email body crypto)
- **DetectedCommitment** — AI detekce závazků v emailech → Todoist sync
- **PostaIgnoreRule** — blacklist odesílatelů/domén (contains/domain/exact)
- **PostaDeletionLog** — audit smazaných emailů (96d retention)

### B&W Myš (rozhodovací systém)
- **CheckIn**, **RuleViolation**, AI evaluace přes `bwmys-ai.ts`

### Health (osobní data z Apple Health Export)
- **HealthMetric**, **HealthAnalysis**, **HealthEcg**

### Soubory & sdílení
- **SharedFile**, **ProjectFile**, **SpizFile** — Spíž (file shares 14d expirace)

### Notifikace
- **WebPushSubscription** — Web Push subscriptions (endpoint+p256dh+auth+label)
- **PageLink** — user-defined sidebar shortcuts (od 2026-05-27)
- **AiUsageLog** — token tracking per request (Gemini Pro/Flash pricing)

### Vector search
- pgvector extension v Postgres pro semantic search
- `vector(768)` embeddings z Gemini text-embedding-004 (1536 v některých případech)

## Autentizace & autorizace

**Single-user** = pouze Gideon. Žádné role.

- **Login** (`/api/auth/login`) — argon2 verifikace hesla, JWT token v `session` cookie
- **JWT** — jose library, HS256, 7denní TTL, `sameSite: strict`, `secure` v produkci
- **Middleware** (`src/middleware.ts`) — proxy auth na všechny non-public routes
- **Public routes** — `/login`, `/i/[token]` (Studánka host), `/g/[token]` (Spíž share),
  `/call-log/[token]` (Petr na mobilu), `/booking/[token]` (booking invite),
  `/share/[token]` (Timeline share), `/api/cron/*` (token-gated CRON_SECRET)
- **WebAuthn** — model existuje, UI částečně rozpracované (TODO)
- **Rate limiting** — `src/lib/rate-limit.ts` (login) + `src/lib/page-rate-limit.ts`

## State management

- **Server state** = Prisma + Postgres (single source of truth)
- **Client islands** = React 19 + `useState`/`useEffect` (žádný Redux/Zustand)
- **Polling** = 4-5s tichý refresh (load(false) pattern) místo websocketů
- **Fire-and-forget AI** = module-level `Set<InFlight>` drží Promise references
  proti GC (Astro/Node bug — viz GOTCHAS.md)

## API & komunikace

- **REST** přes `src/pages/api/**.ts` (Astro endpoints)
- **Žádný tRPC/GraphQL** — jednoduché POST/GET s `Response.json()`
- **Zod** pro validaci vstupů
- **Frontend fetch** = nativní `fetch()` (žádný axios/tanstack-query)

### Klíčové API skupiny

```
/api/auth/{login,logout,me,passkey}.ts        — autentizace
/api/ai/{chat,ask,gemini}.ts                  — Gemini chat + RAG
/api/posta/**                                 — Email Intelligence
/api/calendar/**                              — události + booking
/api/booking/[token]/**                       — public booking flow
/api/studna/[id]/**                           — Studánka projekt
/api/integrations/google/**                   — OAuth + Gmail/Calendar/People
/api/cron/{scheduler,*}                       — dispatcher pattern, DSM volá jen scheduler
/api/contacts/{sync,bulk,...}                 — iCloud + Google sync
/api/push/{subscribe,filters}                 — Web Push subscriptions + per-source
/api/todoist/{sync,push}                      — obousměrný úkolový sync
/api/diagnose/**                              — read-only diagnostické endpointy
```

## Cron pattern

**KLÍČOVÉ**: DSM Task Scheduler volá **jen jeden endpoint** —
`/api/cron/scheduler`. Ten si dispatchuje vše dle `CRON_JOBS` pole
v `src/lib/cron-schedule.ts`.

Pro novou cron úlohu:
1. Endpoint v `src/pages/api/cron/<jmeno>.ts`
2. Záznam do `CRON_JOBS` v `cron-schedule.ts` s `cronExpression` (5-segment)
3. **ŽÁDNÉ DSM změny** — scheduler se dispatchuje sám

Aktuální cron úlohy (~15): daily-projects-digest, push-notifications,
cleanup-audio, cleanup-spiz, backup, posta-sync, posta-cleanup,
posta-embed, posta-commitment-sync, gmail-watch, sync-icloud-contacts,
sync-google-contacts, booking-sweep, gemini-usage-summary, …

Viz `feedback_cron_dispatcher_pattern.md` v memory.

## Klíčové soubory

| Soubor | Co dělá |
|--------|---------|
| `src/middleware.ts` | Auth proxy, security headers, rate limit |
| `src/lib/session.ts` | JWT cookie session (jose, Astro Cookies API) |
| `src/lib/db.ts` | Prisma lazy singleton (adapter-pg) |
| `src/lib/env.ts` | zod-validated env (lazy Proxy) |
| `src/lib/gemini.ts` | Gemini client (Vertex AI nebo aistudio) |
| `src/lib/rag.ts` | pgvector RAG (embed → search → generate) |
| `src/lib/cron-schedule.ts` | Cron dispatcher (single source of truth) |
| `src/lib/notifications.ts` | `/notifikace` agregace + blacklist filter |
| `src/lib/posta-*.ts` | Email Intelligence (~10 souborů) |
| `src/lib/carddav.ts` + `icloud-contacts.ts` | iCloud CardDAV sync |
| `src/lib/google-*.ts` | Google APIs (calendar, contacts, oauth, people) |
| `src/lib/booking.ts` | Booking logika (kolize, lead time, working hours) |
| `src/lib/process-*.ts` | Stage 1+2 audio processing pipelines |
| `src/lib/ai-prompts.ts` | AI prompty + alias tabulka |
| `src/lib/navody.ts` | User-facing dokumentace modulů (`/navody`) |
| `prisma/schema.prisma` | ~50 modelů |
| `docker-entrypoint.sh` | chown → heal-migrations → migrate deploy → start |
| `Dockerfile` | Multi-stage (deps, prod-deps, builder, runner) |
| `astro.config.mjs` | Node adapter standalone, React integration |

## Závislosti třetích stran

| Balíček | Účel |
|---------|------|
| `astro@6` + `@astrojs/node@10` | SSR framework + Node adapter |
| `@astrojs/react@5` + `react@19` | React islands |
| `@prisma/client@7` + `@prisma/adapter-pg@7` | ORM s pg adapter |
| `@google/genai@1.50` | Gemini Pro/Flash + text-embedding |
| `googleapis@171` | Gmail/Calendar/People API |
| `tsdav@2.2` | CalDAV/CardDAV (Apple, Google) |
| `ical.js@2.2` | iCal recurrence iterator (must jump-forward — viz GOTCHAS.md) |
| `argon2@0.44` + `jose@6` | Auth (password hash + JWT) |
| `web-push` (production-only, ne v deps) | Web Push protokol — VAPID signing |
| `@simplewebauthn/{browser,server}@13` | Passkey (rozpracováno) |
| `@react-pdf/renderer@4.5` | PDF generování (Timeline export, Letter) |
| `recharts@3.8` | Charty (Health, B&W Myš) |
| `dayjs@1.11` + `libphonenumber-js@1.12` | Datumy + CZ telefonní normalizace |
| `tailwindcss@4.2` + `@tailwindcss/vite` | Styling (Tailwind v4) |
| `lucide-react@1.8` + `astro-icon` + `@iconify-json/lucide` | Ikony |

## Environment proměnné

Plný seznam v `.env.example`. Kritické:

| Var | Účel |
|-----|------|
| `DB_PASSWORD` | Postgres heslo (compose generuje DATABASE_URL) |
| `DATABASE_URL` | Prisma connection string |
| `SESSION_SECRET` | JWT signing key (min 32 chars) |
| `ADMIN_USERNAME` + `ADMIN_PASSWORD` | Seed prvního usera (jen na clean install) |
| `VERTEX_PROJECT` + `VERTEX_LOCATION` + `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI (preferováno, EU region) |
| `GEMINI_API_KEY` | Fallback pro Vertex (AI Studio) |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | OAuth Gmail/Calendar/People |
| `BOOKING_MAGIC_LINK_SECRET` | HS256 podpis booking tokenů |
| `CRON_SECRET` | DSM Task Scheduler → /api/cron/scheduler auth |
| `RESEND_API_KEY` + `NOTIFICATION_FROM/EMAIL` | Email sending (přesun do SMTP2GO 2026-05-27) |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | Web Push protokol — **MUSÍ být v compose `environment:` block, ne jen v `.env`!** (viz GOTCHAS.md) |
| `SIRI_API_TOKEN` | Siri Shortcut auth |
| `BACKUP_REMOTE_HOST/MODULE/PATH` | rsync na druhý NAS |
| `APP_URL` | Public URL (default `https://www.raseliniste.cz`) |
| `TZ` | `Europe/Prague` — kritické pro booking! (Synology Alpine = UTC default) |

## Deployment

Plný návod v `SYNOLOGY_DEPLOY_PATTERN.md`.

Quick reference:
- **GitHub Actions** build (`.github/workflows/docker-build.yml`) → push na ghcr.io
- **DSM Container Manager** → Project `raseliniste` → Manual Pull → Recreate
- **Health check** Postgres (`pg_isready -U raseliniste`)
- **Volume**: `postgres_data_v1` (named volume), `./uploads` (bind mount), `./cache`, `./backups`
- **Migrace** = automaticky v entrypointu (`prisma migrate deploy`)
- **Backup** = `/api/cron/backup` à 2:00 → pg_dump + uploads.tar.gz → rsync na druhý NAS

## Vizuální jazyk

### Současné: Gide-on brand (2026-06-18/19, na branchi `claude/redesign-gideon`, čeká deploy)

- **Light + dark theme** přes `[data-theme]` atribut + localStorage `"gide-on-theme"`. Bootstrap script v `Base.astro` pre-render proti flash.
- **Paleta:** Ink `#0E0E10` / Cream `#F4EFE6` / Signal Coral `#FF5C2E` (max 10% UI plochy) / Teal `#1B4E50` / Sand `#EAC9A2` + teplá grayscale (g-50…g-900, biased k Ink).
- **Typo:** Space Grotesk Variable (sans + bold display) + JetBrains Mono Variable (eyebrow, čísla). Fraunces serif odchází.
- **Per-modul tinty** (peach/mint/butter/sky/lavender/sage/rose/pink) JEN pro identity: sidebar ikona, eyebrow nadpis, dashboard tile, badge. NIKDY pro CTA.
- **Wordmark:** `GideonWordmark.tsx` pure-CSS scalable se switchem (sizes tiny/xs/sm/md/lg/xl/hero/cover). Nahrazuje AnimatedG.astro + modrou „G".
- **Brand modal:** `modal-overlay` (subtle ink 35% light / 70% dark) + `modal-panel` (var(--surface-elevated) + 1px border + soft shadow). Nahrazuje `bg-black/60 + glass-strong`.
- **Service Worker auto-update:** `VERSION="gide-on-v1"`, postMessage `SW_UPDATED`, `SwUpdateBanner.tsx` ukáže coral banner „Nová verze připravena → Restartovat".

### Legacy: Liquid Glass (stále v `main`, do prvního pushe redesignu)

- Dark-only (žádný light mode), půlnoční modré pozadí.
- Glass povrchy `.glass-subtle/.glass/.glass-strong`.
- Fraunces + Geist + Geist Mono.

Detail: `src/styles/global.css`, memory `feedback_brand_palette_rules.md`, `session_2026_06_18_19_redesign_gideon.md`.

## Document parsing pipeline (Studánka host upload, 2026-06-19)

Host nahraje PDF/DOCX/XLSX/TXT do projektu Studánky → extrakce textu → RAG index.

```
Browser (GuestRecorder.tsx)
  └─ POST /api/me/[token]/upload-document
       ├─ Auth: guestToken + ProjectInvitation.canUploadAudio flag
       ├─ Rate limit: 30/h
       ├─ Max 50 MB
       └─ Uloží do project-documents/ + ProjectFile row (extractionStatus: pending)
            │
            └─ Fire-and-forget worker
                 ├─ detectDocKind(mime, filename) → pdf|docx|xlsx|txt
                 ├─ parseDocument(buffer) → { text, truncated }   (max 100k chars)
                 │    ├─ pdf  → pdf-parse (dynamic import)
                 │    ├─ docx → mammoth.extractRawText
                 │    ├─ xlsx → xlsx SheetJS sheet_to_csv per sheet
                 │    └─ txt  → buffer.toString("utf-8")
                 ├─ Update ProjectFile.extractedText + extractionStatus = "ok"
                 └─ indexEntity({ sourceType: "project-document", id, text, projectId })
                      └─ Gemini text-embedding-004 → RagChunk rows
```

Klíčové soubory:
- `src/lib/document-parser.ts` — `detectDocKind`, `parseDocument`
- `src/pages/api/me/[token]/upload-document.ts` — endpoint
- `src/lib/rag.ts` — RagSource type rozšířen o `"project-document"`
- `src/components/GuestRecorder.tsx` — `isDocumentByName()`, endpoint selection
- `src/components/StudnaDetail.tsx` — admin zobrazí `extractionStatus` badge + jméno hosta
- `src/pages/me/[token].astro` — host vidí posledních 5 dokumentů + status

Detail: migrace `20260619180000_studanka_documents` (ProjectFile.guestUserId FK + extractedText + extractionStatus + extractionError).
