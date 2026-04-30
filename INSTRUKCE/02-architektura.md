# 02 — Architektura

## Stack

| Vrstva | Technologie | Pozn. |
|---|---|---|
| Jazyk | TypeScript 5 strict | |
| Runtime | Node 22 (Alpine v Dockeru) | |
| Framework | **Astro 6** SSR (`output: server`, Node adapter `mode: standalone`) | Bez Next.js (původně Next 16 → opuštěno kvůli prerender bugu) |
| React | 19 (jen pro interaktivní islands) | |
| DB | **PostgreSQL 16 Alpine** | druhý kontejner v compose |
| ORM | **Prisma 7** + `@prisma/adapter-pg` + `pg` | Klient v `src/generated/prisma` (gitignored) |
| Styling | **Tailwind v4** + shadcn-style tokens + vlastní `glass` utility | OKLCH, dark-only |
| Fonty | **Fraunces** (serif), **Geist** (sans, **default pro h1/h2/h3**), **Geist Mono** | přes `@fontsource-variable/*` |
| Ikony | **Lucide** (`astro-icon` + `@iconify-json/lucide` + `lucide-react`) | |
| Auth | argon2id + jose JWT cookie + WebAuthn passkey | |
| Validace | **zod** | každý API endpoint |
| AI | `@google/genai` (Gemini 2.5 Flash/Pro) | server-side only |
| Grafy | **Recharts** | Health + AI usage |
| Markdown | **marked** | |
| Email | **Seznam SMTP** (primární, v UserIntegration), Resend fallback | |
| Audio | `MediaRecorder` browser API + `@google/genai` audio transcribe | |

## Klíčová architektonická rozhodnutí

### 1. Single-user, ale schémata multi-user-ready
Vše má `userId`, jen v praxi je 1 row. Až bude potřeba multi-user, infrastruktura je tam.

### 2. Vertex AI primárně, AI Studio fallback
- Vertex (`VERTEX_PROJECT` v env) = preferred (EU residency, no-training)
- AI Studio (`GEMINI_API_KEY`) = fallback pro audio > 14 MB (Vertex Files API neexistuje)
- Konfigurace v `src/lib/gemini.ts` (`getGemini()`)

### 3. Async upload pattern pro audio
Klient dostane „uloženo" hned po uploadu na disk + DB row. AI běží na pozadí přes **fire-and-forget Promise s module-level Set pinningem** (chrání před GC v Astro/Node).

```ts
const inFlight = new Set<InFlight>();
entry.promise = (async () => { /* AI work */ inFlight.delete(entry); })();
inFlight.add(entry);
```

**KRITICKÉ:** Bez `Set` pinningu Node garbage-collectoval Promise → recording trčel ve „processing" navždy (commit 2f32fac fix).

### 4. Two-stage audio pipeline
- **Stage 1:** Flash plain-text přepis (žádný JSON, vysoká spolehlivost)
- **Stage 2:** Pro/Flash JSON analýza nad přepisem (žádné audio v requestu)

I když Stage 2 selže, transcript je vždy uložený. Plus 3× retry s exp backoff.

### 5. AI prompty: hardcoded defaults + DB override
- Default v `src/lib/ai-prompts.ts` (`DEFAULT_PROMPTS` Record).
- Override v `AiPrompt` tabulce.
- `getPrompt(module)` → DB (60s cache) → fallback default.
- UI v `/settings/ai-prompts` s edit + reset na default.

### 6. Smart Todoist routing pro delegaci
- assignedToContact → top-level projekt jménem assignee
- nebo projekt „Lidé" → sekce jménem assignee (vytvoří pokud chybí)
- nebo default `mojeUkoly`
- Detail v `src/lib/task-todoist-push.ts`

### 7. AI usage tracking
Tabulka `AiUsageLog`, `callTracked()` wrapper kolem každého `generateContent`. UI v `/settings/ai-usage` (Recharts dashboard, per modul/model/den).

### 8. Wake Lock pro audio
`useRecordingProtection` hook — Screen Wake Lock + visibility change tracking + audio sanity check po Stop. Aplikováno na všechny 4 recordery (DiktatRecorder, OwnerRecorder, GuestRecorder, TaskAudioRecorder).

## Datový model — přehled

```
User (Gideon, single)
├── Session, WebauthnCredential, ApiToken
├── Recording → Entry (Capture flow, status PENDING/CONFIRMED/DISCARDED)
├── HealthMetric, HealthEcg, HealthAnalysis
├── Contact → Phone, ContactEmail, CallLog (Firewall)
│   └── @relation TaskAssignee → Task[]
├── UserIntegration (provider: todoist|smtp|google|icloud, AES encrypted)
├── LetterSender → LetterRecipient → Letter
├── ProjectBox (Studna) → ProjectInvitation → ProjectRecording → ProjectSummary
├── GuestUser (Studna host)
├── Task (NEW — samostatný od Entry, source: manual|audio|quickadd|capture)
├── TaskAudioBatch (NEW — Ozvěna úkoly diktát, status processing/review/committed/discarded/error)
├── JournalEntry (NEW — Deník samostatný, mood enum, tags[], people[])
├── AiUsageLog (NEW — tracking Gemini calls)
└── AiPrompt (NEW — override defaultů z kódu)

CalendarEvent (Google primary + iCloud syn + iCloud partnerka)
├── Location (Praha, Plzeň, Brno, …)
├── BookingInvite (token, magic-link confirm)
├── DayNote (errands "při cestě")
├── RuleViolation (log porušení pravidel)
└── BriefingDigest (noční briefing 22:00)
```

Detail viz `prisma/schema.prisma` (1000+ řádků, sekce na konci jsou nejnovější).

## Public vs auth endpoints

**Public (whitelist v `src/middleware.ts`):**
- `/login`, `/api/auth/login` (+passkey/logout)
- `/api/ingest` (Bearer), `/api/journal/ingest` (Bearer/x-api-key), `/api/health-ingest` (x-api-key)
- `/api/cron/*` (x-cron-key)
- `/me/*`, `/api/me/*` (Studna guest, autorizace přes guestToken v URL)
- `/i/*`, `/schuzka` (booking — token v URL)
- `/api/booking/by-token/*`, `/api/booking/reserve`, `/api/booking/confirm` (HMAC magic-link)
- `/call-log`, `/call-log/thanks`, `/api/call-log/submit` (Gideonův Firewall)

**Vše ostatní vyžaduje session cookie** (httpOnly, sameSite=lax, secure v produkci).

## Soubory které musíš znát

| Soubor | Co tam je |
|---|---|
| `src/lib/gemini.ts` | Gemini klient (Vertex/AI Studio dual-mode) + DEFAULT_MODEL/ANALYSIS_MODEL |
| `src/lib/ai-prompts.ts` | DEFAULT_PROMPTS + getPrompt() s cache |
| `src/lib/gemini-usage.ts` | callTracked() wrapper + AiUsageLog |
| `src/lib/audio-transcribe.ts` | Two-stage transcribe (Stage 1 + Stage 2 + retries) |
| `src/lib/process-recording.ts` | Studna AI processing (fire-and-forget pin) |
| `src/lib/process-task-audio.ts` | Ozvěna úkoly extrakce + JSON repair |
| `src/lib/process-journal-audio.ts` | Ozvěna deník strukturování + markdown parser |
| `src/lib/journal-monthly-review.ts` | Měsíční rekapitulace (jen METADATA + POZNÁMKY EDITORA) |
| `src/lib/rules.ts` + `rules-config.ts` | 18 kalendářových pravidel |
| `src/lib/event-parser.ts` | Vertex Flash parser pro /quickadd |
| `src/lib/booking.ts` + `magic-link.ts` | Booking pipeline + HMAC tokeny |
| `src/lib/google-calendar.ts` + `google-people.ts` + `icloud-calendar.ts` | Sync moduly |
| `src/lib/briefing.ts` | Noční briefing 22:00 → Todoist |
| `src/lib/task-todoist-push.ts` | Smart Lidé/sekce routing |
| `src/middleware.ts` | Auth proxy + security headers + apex redirect |
| `src/components/useRecordingProtection.ts` | Wake Lock + visibility hook |
