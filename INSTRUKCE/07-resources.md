# 07 — Resources (kde co je)

## Repo + nasazení

| Co | Kde |
|---|---|
| Repo (private) | https://github.com/duchnotvor/raseliniste |
| Docker image (public) | ghcr.io/duchnotvor/raseliniste/app:latest |
| Doména | https://www.raseliniste.cz |
| NAS | Synology DS718+ (Gideon doma) |
| Compose dir na NASu | `/volume1/docker/raseliniste/` |
| .env produkční | `/volume1/docker/raseliniste/.env` |
| Uploads volume | `/volume1/docker/raseliniste/uploads/` (bind mount) |
| GCP service account | `/volume1/docker/raseliniste/gcp-key.json` (chmod 644!) |
| Deploy script | `~/deploy.sh` na NASu (jeden příkaz) |

## Kdy použít který dokument

| Situace | Dokument |
|---|---|
| Zorientovat se jako nová Claude session | `INSTRUKCE/00-START-HERE.md` (jsi zde) |
| Co se právě teď děje | `INSTRUKCE/01-aktualni-stav.md` |
| Stack a klíčová architektonická rozhodnutí | `INSTRUKCE/02-architektura.md` |
| Přehled všech modulů | `INSTRUKCE/03-moduly.md` |
| Co se má dělat dál | `INSTRUKCE/04-todo-list.md` |
| Jak Gideon pracuje | `INSTRUKCE/05-styl-prace.md` |
| Známé pasti / debug | `INSTRUKCE/06-troubleshooting.md` |
| Detail technický (1000+ řádků) | `HANDBOOK.md` |
| Operativní příručka pro Gideona | `RUNBOOK.md` |
| Předávací dokument (může být zastaralý) | `HANDOFF.md` |
| Uživatelské PDF manuály | `Návody/*.pdf` |
| Briefy modulů (deník, úkoly, kalendář) | `raseliniste-*-brief.md` v root |
| Memory napříč sessions | `/Users/petrperina/.claude/projects/.../memory/` |

## Důležité soubory v repo

```
raseliniste/
├── INSTRUKCE/                ← TY JSI ZDE
│   ├── 00-START-HERE.md
│   ├── 01-aktualni-stav.md
│   ├── 02-architektura.md
│   ├── 03-moduly.md
│   ├── 04-todo-list.md
│   ├── 05-styl-prace.md
│   ├── 06-troubleshooting.md
│   └── 07-resources.md
│
├── CLAUDE.md                 ← auto-loaded každou Claude session
├── AGENTS.md                 ← reference pro Claude (varování o Next.js, ale to už neplatí — máme Astro)
├── HANDBOOK.md               ← technická reference (1023 řádků), na konci changelog 2026-04-29
├── RUNBOOK.md                ← operativní příručka pro Gideona
├── HANDOFF.md                ← předávací dokument (zastaralý — viz INSTRUKCE)
├── SYNOLOGY_DEPLOY_PATTERN.md ← deploy pattern (referenční)
│
├── raseliniste-denik-audio-brief.md   ← Gideonův brief pro deník
├── raseliniste-ukoly-audio-brief.md   ← Gideonův brief pro úkoly
├── raseliniste-kalendar-brief.md      ← v Downloads, Gideon přiloží přes Read
│
├── Návody/                   ← user PDFs + HTML zdroje
│   ├── 01-kalendar.pdf      (7 stran)
│   ├── 02-ukoly.pdf         (7 stran)
│   ├── 03-crony.pdf         (7 stran, 11 cronů)
│   ├── 04-testy.pdf         (8 stran, 50+ test cases)
│   ├── 05-denik.pdf         (7 stran)
│   └── README.md
│
├── prisma/
│   ├── schema.prisma        ← 1000+ řádků, 14+ migrací
│   └── migrations/          ← všechny applied + pending
│
├── src/
│   ├── pages/               ← Astro routes
│   │   ├── api/             ← endpointy (104+ souborů)
│   │   ├── ozvena.astro     ← sjednocený diktát
│   │   ├── start.astro      ← NOVÉ — vstupní stránka
│   │   └── settings/        ← landing s dlaždicemi
│   ├── components/          ← React islands (40+ souborů)
│   ├── layouts/             ← Base + Shell
│   ├── lib/                 ← server-side utility (35+ souborů)
│   ├── styles/global.css    ← Tailwind + tokens + glass
│   ├── middleware.ts        ← auth + security
│   └── generated/prisma/    ← Prisma client (gitignored)
│
├── public/
│   ├── apple-touch-icon.png ← NOVÁ ikona „úsvit"
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── raseliniste-icon.svg ← zdroj pro PNG
│   ├── manifest-start.json  ← PWA pro /start („Rašeliniště")
│   ├── manifest-ozvena.json ← PWA pro /ozvena (zachováno)
│   ├── manifest-ukoly-audio.json ← PWA pro /ukoly/audio (legacy)
│   ├── favicon.svg
│   └── fonts/               ← NotoSans + NotoSerif (PDF)
│
├── docker-compose.yml       ← produkční (app + postgres)
├── docker-compose.dev.yml   ← jen postgres pro dev
├── docker-entrypoint.sh     ← chown + heal + migrate + start
├── Dockerfile               ← multi-stage
├── astro.config.mjs
├── prisma.config.ts
├── tsconfig.json
├── package.json
└── .env.example
```

## Memory soubory (persistuje napříč sessions)

```
/Users/petrperina/.claude/projects/-Users-petrperina-CLOUDS-CLOUDE-PROJECTS-raseliniste/memory/
├── MEMORY.md                            ← index
├── user_profile.md                      ← Gideon profile
├── design_preferences.md                ← design history (4 zamítnuté pokusy)
├── todo_studna_async_still_failing.md   ← VYŘEŠENO commit 2f32fac
└── todo_gcp_billing.md                  ← Aktivní TODO
```

## Klíčové URL na produkci

| URL | K čemu |
|---|---|
| https://www.raseliniste.cz/ | Dashboard (Gideon login) |
| https://www.raseliniste.cz/start | **Sjednocená vstupní stránka** (PWA „Rašeliniště") |
| https://www.raseliniste.cz/ozvena | Ozvěna (legacy PWA) |
| https://www.raseliniste.cz/login | Login (heslo + Touch ID) |
| https://www.raseliniste.cz/api/health/ai | Test ping AI |
| https://www.raseliniste.cz/api/diagnose/studna | Diagnostický endpoint |
| https://www.raseliniste.cz/me/<token> | Public link pro Studna hosty |
| https://www.raseliniste.cz/i/<token> | Public link pro booking |
| https://www.raseliniste.cz/schuzka | Public cold lead booking |
| https://www.raseliniste.cz/call-log | Public Gideonův Firewall (vzkaz) |

## Env proměnné — kde co dělá

V `/volume1/docker/raseliniste/.env`:

| Proměnná | K čemu |
|---|---|
| `DATABASE_URL` | Postgres connection (compose interní) |
| `SESSION_SECRET` | Cookie + AES klíč. ≥ 32 znaků. |
| `APP_URL` | `https://www.raseliniste.cz` |
| `NODE_ENV` | `production` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Pro první seed (po deployi) |
| `VERTEX_PROJECT` + `VERTEX_LOCATION` + `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI (preferred, EU residency) |
| `GEMINI_API_KEY` | AI Studio fallback (pro audio > 14 MB v Vertex módu) |
| `GOOGLE_CLIENT_ID` + `_SECRET` + `_REDIRECT_URI` | Google OAuth (Calendar + Contacts) |
| `BOOKING_MAGIC_LINK_SECRET` | HMAC pro booking confirmation maily |
| `BOOKING_MAGIC_LINK_TTL_HOURS` | Default 24 |
| `SIRI_API_TOKEN` | Pro budoucí Siri shortcut „zkontroluj termín" |
| `RESEND_API_KEY` nebo SMTP cfg | Mail (Resend / Seznam SMTP) |
| `NOTIFICATION_FROM` + `NOTIFICATION_EMAIL` | Mail odesílatel + globální fallback příjemce |
| `CRON_SECRET` | x-cron-key auth pro DSM cron tasky |

## Crony v DSM Task Scheduler (11 úloh)

Detail per úloha + curl command v `Návody/03-crony.pdf`. Krátký přehled:

1. sync-calendars (každých 5 min)
2. sync-contacts (denně 04:00)
3. nightly-briefing (denně 22:00)
4. retry-stuck-recordings — Studna (každých 15 min)
5. cleanup-audio — Studna (denně 03:00)
6. daily-projects-digest — Studna (denně 18:00)
7. monthly-health-report (poslední den měsíce 23:00)
8. cleanup-expired-invites — Bookingy (denně 01:00)
9. cleanup-task-audio-batches — Ozvěna úkoly (denně 02:30)
10. retry-stuck-task-batches — Ozvěna úkoly (každých 5 min)
11. cleanup-journal-audio — Deník (denně 03:15)
