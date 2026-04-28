# Rašeliniště

Osobní informační systém Petra „Gideona" Periny. Single-user, max security, hostovaný na Synology DS718+ v Dockeru.

> **Nová Claude session:** otevři [`HANDOFF.md`](./HANDOFF.md) — má aktuální stav a immediate next steps.
> **Pro detailní technickou dokumentaci** otevři [`HANDBOOK.md`](./HANDBOOK.md).
> **Pro provozní postupy** (deploy, backup, troubleshoot) otevři [`RUNBOOK.md`](./RUNBOOK.md).

---

## Stack

- **Astro 6** SSR + **React 19** islands
- **TypeScript 5** strict
- **Prisma 7** + **PostgreSQL 16**
- **Vertex AI Gemini 2.5** (Flash + Pro, EU region) — fallback `GEMINI_API_KEY`
- **Tailwind v4** + custom OKLCH design tokens (Liquid Glass dark theme)
- Auth: argon2id + WebAuthn passkey (Touch ID)

## Živé moduly (11)

| Modul | Cesta | Co dělá |
|---|---|---|
| Auth | `/login` | heslo + Touch ID passkey |
| Capture | `/capture`, `/triage` | diktát → Gemini Flash → 5 typů Entry |
| Úkoly | `/tasks` | CONFIRMED TASKy + push do Todoistu |
| Poznámky | `/notes` | KNOWLEDGE+THOUGHT, search/filter |
| Deník | `/journal` | direct ingest + AI redakce + GPS |
| Zdraví | `/health` | HAE ingest + dashboard + Gemini Pro analýzy |
| Kontakty | `/contacts` | vCard + Google sync, VIP, booking módy |
| Firewall | `/call-log`, `/firewall` | veřejný formulář pro vzkazy → Todoist + mail |
| Dopisy | `/letters` | 2 PDF témata, AI „Učesat" |
| Studna | `/studna`, `/me/<token>` | sdílené projektové boxíky s audio + AI rozborem |
| **Kalendář** | `/calendar` | Google Calendar sync (fáze 1a) — iCloud + rules + /quickadd ve fázi 1b |

## Lokální dev

```bash
# 1. deps
npm install

# 2. local Postgres
docker compose -f docker-compose.dev.yml up -d

# 3. .env.local — zkopíruj z .env.example, vyplň DATABASE_URL,
#    SESSION_SECRET, GEMINI_API_KEY (nebo VERTEX_PROJECT)

# 4. migrace + seed admina
npx prisma migrate deploy
npm run db:seed

# 5. dev server
npm run dev
# → http://localhost:3000/login
```

Detailní setup viz [`HANDBOOK.md`](./HANDBOOK.md#rychlý-start).

## Deploy

Push do `main` → GitHub Actions postaví image → na NASu spustíš:

```bash
sudo /volume1/docker/raseliniste/deploy.sh
```

Skript stáhne aktuální `docker-compose.yml`, validuje YAML, pulluje image, recreate kontejneru. Detailní postup viz [`RUNBOOK.md`](./RUNBOOK.md#deploy-nové-verze).

## Klíčové konvence

- **Žádný Python v image** — vše Node.js 22
- **Žádný background runner** — synchronní requesty + Synology cron
- **AI volání** — vždy přes `getGemini()` v `src/lib/gemini.ts`, nikdy ne z klienta
- **Bezpečnost** — passkey povinný, JWT cookie httpOnly+strict, AES-256-GCM pro secrets v DB
- **Komunikace s majitelem** — česky, stručně, žádné spekulace nad rámec zadání

## Kde co je

```
src/
├── pages/           — Astro routes (server) a /api/*
├── components/      — React islands (interaktivní UI)
├── layouts/         — Base.astro + Shell.astro (sidebar)
├── lib/             — server-side utility (db, gemini, mailer, …)
├── styles/          — global.css s OKLCH design tokeny
├── assets/fonts/    — TTF fonty pro PDF (Noto Sans/Serif)
└── generated/prisma — Prisma client (gitignored)

prisma/
├── schema.prisma    — datový model
└── migrations/      — 13 migrací

public/              — statické soubory (favicon, fonts pro PDF, apple-touch-icon)
.github/workflows/   — CI: docker-build.yml
```

## License

Soukromé. Všechna práva vyhrazena.
