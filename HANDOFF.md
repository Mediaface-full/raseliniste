# Handoff — pro další Claude session

> **⚠ ZASTARALÉ.** Aktuální stav najdeš v **`INSTRUKCE/HANDOFF-2026-05-04.md`** (nejnovější — kalendářové pohledy, rituály, výročí).
> Předchozí session: `INSTRUKCE/HANDOFF-2026-05-03.md` (Todoist sync, VIP firewall).
>
> Tento root soubor držíme z historických důvodů — původní fáze 1a kalendáře v 2026-04.

---

## Historický záznam — 2026-04-28

**Datum:** 2026-04-28
**Stav (tehdy):** Kalendář fáze 1a hotová, čeká na deploy + autorizaci. Rozjedeme fázi 1b.

---

## TL;DR pro novou session

Petr pracoval s předchozí Claude session na novém modulu **Kalendář & Bookingy** (brief v `Downloads/raseliniste-kalendar-brief.md` na Petrově Macu — pokud potřebuješ konzultovat). Implementovali jsme **fázi 1a**: Google Calendar + Contacts sync + `/calendar` UI. Code je zacommitnutý lokálně, **NENÍ pushnutý do GitHubu** (2 nejnovější commity: `fix(env)` + `docs(runbook): bod 15a`).

**Hned po startu nové session:**
1. Zeptej se Petra, jestli pushnul commity a deploynul
2. Pokud ano → autorizoval Google? → projeď test fáze 1a (kroky níže)
3. Pokud OK → pokračujeme **fází 1b**: iCloud sync + Rules engine + `/quickadd`

---

## Co je systém Rašeliniště

Osobní informační systém Petra „Gideona" Periny. Single-user, max security, hostovaný na Synology DS718+ v Dockeru přes ghcr.io. Detail v `HANDBOOK.md`.

**Stack:** Astro 6 SSR + React 19 + Prisma 7 + PostgreSQL 16 + Vertex AI Gemini 2.5. EU region. **Žádný Python**, žádný Redis, žádný S3, žádný background runner.

**Domain:** https://www.raseliniste.cz

**11 živých modulů** (po fázi 1a Kalendáře):
1. Auth (heslo + passkey)
2. Capture (diktát → Vertex Flash → Triage)
3. Úkoly (`/tasks`)
4. Poznámky (`/notes`)
5. Deník (`/journal`)
6. Zdraví (`/health`)
7. Kontakty (`/contacts`)
8. Firewall (`/call-log`, `/firewall`)
9. Dopisy (`/letters`)
10. Studna (`/studna`, `/me/<token>`)
11. **Kalendář (`/calendar`) — fáze 1a hotová, read-only Google sync**

---

## Komunikace s Petrem

- **Vždy česky, stručně.** Žádná vata, žádné spekulace.
- **Neprogramuj dopředu** — nepřidávej abstrakce/features, které neřekl.
- **Před riskem se ptej** (push --force, rm -rf, drop DB, mazání migrací).
- Petr není ajťák. Vyhýbej se žargonu. Když mu dáváš příkaz do shellu, řekni přesně **co kam vložit**.
- Petr mívá problém zorientovat se v dlouhých odpovědích — strukturuj číslovaně, používej tabulky.
- Tykání. Petr ti tyká.
- **Vyhni se vokativům jmen** v UI (Češtinské skloňování je trable). „Ahoj!" místo „Ahoj Karle".

---

## STAV PRÁVĚ TEĎ (28. 4. 2026, večer)

### Co je hotové dnes

**Studna modul** (kompletně) — sdílené projektové boxíky pro hlasové záznamy:
- `/studna` (list), `/studna/[id]` (detail s 4 taby), `/studna/nahravka` (owner recorder)
- `/me/<guestToken>` public host page s MediaRecorder + countdown 10 min
- Audio transkripce přes Vertex Flash (krátké) / Pro (briefy nad 18 MB přes Files API)
- Onboarding PDFs (2 verze: standard + brief, NotoSans, logo G)
- Cron entries: `daily-projects-digest` 7:00 ráno (24h okno), `cleanup-audio` 03:00 *(NEnastaveno v DSM)*

**Kalendář fáze 1a** — Google Calendar + Contacts sync:
- Schema: 7 nových modelů + Contact extension (isClient/isFriend/isFamily/booking + google fields)
- Libs: `event-classifier` (Vertex Flash), `google-oauth`, `google-calendar`, `google-people`
- API: OAuth start/callback/disconnect, manual sync, /api/calendar/events, 2 crony
- UI: `/calendar` (react-big-calendar, week default, Liquid Glass dark CSS), `/settings/integrations/google`
- Sidebar: Kalendář první v Organizace
- Compose + .env.example: GOOGLE_CLIENT_ID/SECRET/REDIRECT, BOOKING/SIRI vars

**Fix env validation** — `emptyToUndef()` helper v `src/lib/env.ts`. Compose `${VAR:-}` posílá prázdný string, zod `.optional()` to neakceptoval. Trvale opraveno.

### Commity čekající na push (lokálně)

```
1f5a078 fix(env): empty string z compose `${VAR:-}` se převádí na undefined
ea603df docs(runbook): bod 15a — emptyToUndef pro nové env proměnné
```

(Plus všechny Calendar fáze 1a commity od `feat(calendar): fáze 1a` výše.)

### Co Petr zatím neudělal (čeká od něj)

- [ ] **Push** přes GitHub Desktop (cca 8 commitů včetně Studny + Calendar 1a + fixes)
- [ ] Po pushi: `sudo /volume1/docker/raseliniste/deploy.sh` na NASu
- [ ] **Google Cloud Console**: enable *Calendar API* + *People API*, přidat scopes do consent screen, vytvořit OAuth Client ID *„Web application"* s redirect `https://www.raseliniste.cz/api/integrations/google/callback`
- [ ] Doplnit `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` do `/volume1/docker/raseliniste/.env`
- [ ] Recreate kontejneru (`deploy.sh` znovu)
- [ ] Otevřít `/settings/integrations/google` → kliknout *Připojit Google* → autorizovat
- [ ] Ověřit `/calendar` ukazuje Google události a `/contacts` narůst o Google kontakty

### Jak ověřit, že je všechno OK

```bash
# Kontejner běží
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml ps
# musí být: Up X minutes, port 3333:3000

# App odpovídá lokálně
curl -I http://localhost:3333/login
# musí být: HTTP/1.1 200 OK

# Vertex jede
# v prohlížeči: https://www.raseliniste.cz/api/health/ai
# musí vrátit: {"ok":true,"mode":"vertex","model":"gemini-2.5-flash",...}

# Google sync stav
# v prohlížeči (přihlášený): https://www.raseliniste.cz/settings/integrations/google
# musí ukázat connected + počet events + contacts
```

---

## Plán zbývajících fází Kalendáře (z briefu)

**Brief je v Petrových downloads** jako `raseliniste-kalendar-brief.md` (991 řádků). Při pochybnostech ho otevři přes Read tool. Petr ho přiložil v jedné z předchozích zpráv.

### Fáze 1b — iCloud sync + Rules + /quickadd (~2-3 dny)

**Předpoklad:** Petr má Apple ID + app-specific password vygenerované, dva sdílené iCloud kalendáře (syn = hokej, partnerka = NOCNI/DENNI šichty).

**Co postavit:**
- `lib/icloud-calendar.ts` — `tsdav` knihovna, read-only, dva kalendáře (`ICLOUD_SON`, `ICLOUD_PARTNER`)
- `/settings/integrations/icloud` UI — 2 sekce, Apple ID + app password + výběr kalendáře
- `lib/rules.ts` — pravidlový engine (15+ pravidel z briefu sekce 5.2)
- `lib/rules-config.ts` — hardcoded SCHEDULING_CONFIG (online dny = všechny, špička 7-9, Praha út+st, doma po+čt+pá, atd.)
- `lib/prompts/parse-event.ts` — Vertex Flash parser českých hlasových inputů
- `/api/calendar/parse-and-evaluate` + `/api/calendar/events` POST + `/api/calendar/check` (Siri)
- `/quickadd` UI s mobile-first layoutem, mikrofon button, verdikty 🟢/🟡/🔴
- Rozšířit `/api/cron/sync-calendars` o iCloud sync
- Dashboard widget pro RuleViolation banner

**Test set parserů** (Petr s tím schválil že navrhneme my, ať otestujeme klasifikační přesnost):
1. „úterý v 11 ČSOB Praha"
2. „zítra v 9 schůzka u Karla doma"
3. „středa 14:30 oběd s Petrem"
4. „online call s Janou pondělí 10"
5. „13.5. 16:00 ČSOB"
6. „v 8 ráno" (chybí lokace → needsClarification)
7. „schůzka v Plzni příští týden" (chybí čas)
8. „Zoom s klientem zítra v 11"
9. „kafe v Praze ve čtvrtek odpoledne"
10. „celý den 23. května Itálie dovolená"

### Fáze 2 — Bookingy (~3-4 dny)

`BookingInvite` model už je v DB. Postavit:
- `/calendar/invite` UI s autocomplete kontaktů
- `/i/{token}` public page — grid slotů, magic-link confirm
- `/schuzka` public — cold lead form, povinný subject
- `lib/magic-link.ts` — HMAC podpis, TTL 24h
- 4 maily (invite/reservation/confirmation/cancellation) přes Seznam SMTP
- `/api/booking/*` (5 endpointů)
- Cron `/api/cron/cleanup-expired-invites`
- Liquid Glass styling pro public pages

### Fáze 3 — Briefing 22:00 + DayNote (~3 dny)

- `DayNote` + `BriefingDigest` modely už v DB
- `lib/briefing.ts` (Vertex Flash + markdown render)
- `/day/{YYYY-MM-DD}` UI
- Capture integrace: Triage button „spíš DayNote než TASK"
- Cron `/api/cron/nightly-briefing` 22:00 → push do Todoistu (mojeUkoly project)
- Existující plán `morning-pack-list` nahrazujeme nightly briefingem

### Fáze 4 — Polish

- OOO management `/calendar/away`
- `/calendar/locations` admin
- `/calendar/settings` (přesun rules-config do DB)
- PWA manifest pro `/quickadd`
- Volitelně: Google push notifications (replace 5min polling)

---

## Globální TODO list (priority)

**P-0 BLOKUJÍCÍ (před začátkem fáze 1b):**
- Push Calendar fáze 1a + env fix (8+ commitů)
- Deploy + GCP OAuth setup + autorizace v UI
- E2E test fáze 1a: Google se synchronizuje, kontakty se sosaj

**P-1 HOT (následuje):**
- Kalendář fáze 1b (iCloud + Rules + /quickadd)
- Fáze 2 (Bookingy)
- Fáze 3 (Briefing 22:00 → Todoist)
- Fáze 4 (polish)

**P-1 vedle Kalendáře:**
- DSM Reverse Proxy: zvýšit Send/Read-Timeout na 600s pro dlouhé briefy Studny
- DSM Task Scheduler: 5 cron úloh (sync-calendars 5min, sync-contacts 04:00, daily-projects-digest 7:00, cleanup-audio 03:00, monthly-health-report poslední den měsíce, později nightly-briefing 22:00)
- Tasks UX: kalendářní view, inline edit, drag, due date picker
- Tasks pull-sync z Todoistu

**P-2 (potřebné, ale ne urgentní):**
- Dashboard widgety (KPI Studna, Tasks, Firewall)
- Per-projekt ikona Studny
- **🚨 Backup automatizace** (zatím žádný! nightly pg_dump → druhý NAS / Backblaze B2)

**P-3 (nice-to-have):**
- Capture iPhone Shortcut (návod existuje, dořešit reference shortcut JSON)
- Push notifikace pro VIP firewall
- AI chat nad vlastními daty (RAG)

**P-4 (později):**
- Modul Soubory
- Plaud / Superlist integrace
- Claude kouč

---

## Klíčové konvence (čti pozorně)

### Datový model
- Single-user systém, ale schémata mají `userId` everywhere (single user → 1 row, ale infrastruktura ready pro multi-user)
- Šifrované secrets v DB: AES-256-GCM, klíč derivovaný ze `SESSION_SECRET` (`lib/crypto.ts`)
- Per-user `UserIntegration` tabulka pro tokeny (provider: `todoist`, `smtp`, `google`)

### AI
- Volání **vždy** přes `getGemini()` z `src/lib/gemini.ts` (dual-mode Vertex/AI Studio)
- Default `gemini-2.5-flash`, analýzy `gemini-2.5-pro`
- Audio > 18 MB → Files API (ne inline) — viz `lib/audio-transcribe.ts`
- Vždy český prompt, JSON output mode pro strukturovaný response

### PDF
- `@react-pdf/renderer` server-side (SSR external v `astro.config.mjs`)
- Fonty NotoSans + NotoSerif z `public/fonts/` (ne `src/assets/fonts/` — Astro je nezahrnuje do dist/server!)
- Pro PDF apple-touch-icon používáme z `public/apple-touch-icon.png`

### Frontend
- Astro pages = server components. Pro interaktivitu = React island (`client:load`)
- TailwindCSS v4 + custom OKLCH tokens v `src/styles/global.css`
- Liquid Glass aesthetic: `.glass`, `.glass-strong`, dark navy s pastelovými blobs
- Ikony: `lucide-react` (React) / `astro-icon` + `@iconify-json/lucide` (Astro)
- Mobil-first, sidebar off-canvas pod `lg`

### Deploy proces (jediný 1 příkaz)
```bash
# Mac: GitHub Desktop → Push
# NAS:
sudo /volume1/docker/raseliniste/deploy.sh
```
Skript stáhne aktuální compose z GitHub raw, validuje YAML, pulluje image, recreate. **Ne `docker compose restart` — nečte env!**

### Testování
- TypeScript check: `npx tsc --noEmit` (před commitem)
- Build: `npx astro build`
- 0 errors, 0 warnings (jen chunk size info OK)

---

## Známé gotchas (15+ bodů, viz RUNBOOK sekce 8)

**Nejčastější dnes hořelo:**

1. **Empty string z `${VAR:-}` v compose** → zod fail. Fix: `emptyToUndef()` helper v `env.ts`. **Při přidávání nové env proměnné vždy obal**.

2. **`docker compose restart` nečte .env**. Vždy `docker compose up -d --force-recreate`. Lépe: `~/deploy.sh`.

3. **`docker-compose.yml` na NASu se NEAUTO aktualizuje.** Nový compose v repu se na NAS nedostane sám. `deploy.sh` to řeší přes curl.

4. **`gcp-key.json` chmod 644** (ne 600). Kontejner běží jako neroot uvnitř.

5. **Vertex audio > 18 MB** → Files API. Implementováno v `lib/audio-transcribe.ts`.

6. **Astro nezahrnuje `src/assets/*` do `dist/server/`**. Statické soubory dej do `public/`.

7. **Synology DSM nemá `nano`** — jen `vi`. Nebo `tee` pro append.

8. **Heredoc paste do souboru = catastrophe** (omylem se zapíše jako text, ne spustí). Vždy spouštěj v shellu.

9. **MIME audio s codec parametry** (`audio/webm; codecs=opus`) — `lib/uploads.ts` už má strip parametrů.

10. **Synology Reverse Proxy občas zmizí po DSM update**. Když Petr po deployi vidí Webstation defaultní stránku → DSM Control Panel → Login Portal → Reverse Proxy → ověř/oprav záznam pro `www.raseliniste.cz` → `localhost:3333`.

11. **Login attempt rate-limit** (5 fails / 15 min per username) — když Petr nemůže se přihlásit, často to není heslo, ale lock. Smaž LoginAttempt přes psql.

---

## Kde co je v repu

```
src/
├── pages/           — Astro routes a /api/*
│   ├── api/calendar/        — calendar API (events query)
│   ├── api/integrations/    — google + todoist + ostatní
│   ├── api/cron/            — všechny cron endpointy
│   └── ...
├── components/      — React islands
│   ├── CalendarView.tsx          — react-big-calendar wrapper
│   ├── GoogleIntegration.tsx     — settings UI
│   ├── StudnaList/Detail.tsx     — Studna UI
│   └── ...
├── layouts/         — Base.astro + Shell.astro (sidebar)
├── lib/             — server-side utility
│   ├── google-oauth.ts           — OAuth helper
│   ├── google-calendar.ts        — sync + CRUD
│   ├── google-people.ts          — kontakty sync
│   ├── event-classifier.ts       — Vertex Flash classifier
│   ├── todoist-push.ts           — push helper
│   ├── audio-transcribe.ts       — Vertex audio + Files API
│   └── ...
└── generated/prisma — Prisma client (gitignored)

prisma/
├── schema.prisma    — datový model (621+ řádků, 14 migrací)
├── migrations/      — všechny SQL migrace
└── seed-locations.ts — seed Praha + Jílové u Prahy + Plzeň + Brno

public/
├── fonts/           — NotoSans + NotoSerif TTF (pro PDF)
└── apple-touch-icon.png — G logo
```

---

## Pravidla pro práci v rámci nové session

1. **Vždy si přečti** tento HANDOFF.md, pak **HANDBOOK.md** sekce 5 (moduly), 8 (API reference), pak **RUNBOOK.md** sekce 8 (15 gotchas).

2. **Před implementací jakékoliv nové funkce** zkontroluj současný stav:
   ```bash
   git status
   git log --oneline -10
   npx tsc --noEmit  # 0 errors expected
   npx astro build   # 0 errors expected
   ```

3. **Nečekej s commitem** — po každé logické jednotce práce commit + popis. Petr je vlastník, on rozhoduje, kdy push.

4. **Při hlášení chyb od Petra:**
   - Vyžádej `docker compose logs app --tail 50` na NASu
   - Hledej "Error", "Invalid", "EACCES", "ENOENT", "Failed"
   - Pokud kontejner běží OK ale UI 500 → app log
   - Pokud webstation default → DSM Reverse Proxy

5. **Stack overhead** — Petr nepoužívá Python, Redis, S3, BullMQ. Vše synchronně nebo přes Synology cron. Nepřeháněj architekturu.

6. **Při návrhu nového modulu** — vyžádej brief, nedělej domněnky. Petr si projektuje promyšleně.

---

**Pokud nová session začíná, první věta odpovědi musí být potvrzení, že přečetla tento HANDOFF + HANDBOOK + RUNBOOK a má kontext. Pak konkrétní akce co chce Petr dělat.**
