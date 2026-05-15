@AGENTS.md

# Projekt raseliniste — osobní informační systém

Tento soubor se automaticky načte každou novou Claude Code session.

## ⚠️ ČTI NEJDŘÍV (v tomto pořadí):

0. **`INSTRUKCE/CONTACTS-IMPLEMENTATION.md`** ← **AKTUÁLNÍ STAV 2026-05-15** — Kontakty modul **VŠECH 8 FÁZÍ HOTOVÝCH** (kontakty_brief.md F1-F8). iCloud CardDAV sync (pull+push+match A) + Google Workspace sync (push+cleanup+pull-back, 3-úrovňové párování) + `/contacts/tabulka` editor + duplicity merge UI + Find&Replace + Normalizace +420 (CZ rozsahy) + Import/Export VCF/CSV (firemní mode) + auto-backup před PUT/DELETE/merge (Restore UI 80 záloh) + banner novinek z mobilu + bulk akce + skupiny CRUD. **Overlay model**: iCloud core fields + Rašeliniště overlay (isVip/aliases/clientTag/callLogToken/isTeam — sync se netýká). Vlastní vCard 3.0 + CardDAV bez npm deps. Google scope rozšířen `contacts.readonly` → `contacts` (reauth potřeba pro F6). 12 commitů: `175e2fd` … `02edce9`. Zadání: `kontakty_brief.md`.

0b. **`INSTRUKCE/HANDOFF-2026-05-13.md`** — Booking modul kompletní + Pošta scope fix + Todoist 429 retry. Před tímto handoffem byl modul Pošta nasazený ale neimportoval nic (chyběl scope + reauth banner + GCP Gmail API enable). Po pushi 8 commitů (`10f18f2` … `d8ec9d0`) a reauth v `/settings/integrations/google` by mělo začít fungovat.

1. **`INSTRUKCE/POSTA-PHASE-6.md`** — Email Intelligence „Pošta" fáze 6 **FINÁLNÍ** HOTOVÁ. DetectedCommitment detector + confidence routing (auto >=0.85 / needs-confirm 0.55-0.84 / skip <0.55) + soft-link dedup + UI sekce Závazky s 4 subtaby + 1-way Todoist sync (DB primárka) + related email tracking (thread match drží alive) + stale marker 30d. **Modul Pošta kompletní** — fáze 1-6 hotové.

   **Pošta scope opraven 2026-05-13** (commit `28fd888`): `gmail.modify + gmail.send` (čtení + drafty + odesílání reply). Memory `project_posta_module.md` to mělo zapsané, ale fáze 1 implementovala jen readonly+metadata — dohnáno.

   **CRONY:** všechny v `src/lib/cron-schedule.ts`, DSM Task Scheduler volá jen `/api/cron/scheduler` (dispatcher pattern). ŽÁDNÉ DSM změny.

   **DEPLOY GOTCHA:** v GCP Console enable Gmail API jednorázově (viz krok 0 v `docs/email-intelligence/INFRASTRUCTURE.md`). OAuth scope ≠ enabled API.
1b. `INSTRUKCE/POSTA-PHASE-5.md` — Gmail push + encryption + retention
1c. `INSTRUKCE/POSTA-PHASE-4.md` — RAG embeddings + hybrid search
1d. `INSTRUKCE/POSTA-PHASE-3.md` — UI modul `/posta` (SSR, zero JS), digest, sidebar badge
1e. `INSTRUKCE/POSTA-PHASE-2.md` — klasifikace 7-polí, prompts/classify_v1.md
1f. `INSTRUKCE/POSTA-PHASE-1.md` — OAuth + import skeleton
1g. `INSTRUKCE/POSTA-DESIGN-DECISIONS.md` — závazná specifikace pro fáze 2-6
1h. `docs/email-intelligence/RETENTION.md` — 96d retention
1i. `docs/email-intelligence/INFRASTRUCTURE.md` — Cloud Pub/Sub setup
1j. `prompts/classify_v1.md` — klasifikace prompt
1k. `prompts/classify_commitment_v1.md` — commitment detector prompt
2. `INSTRUKCE/HANDOFF-2026-05-10.md` — předchozí stav: Triage t-* dropdown, smart routing 6-úrovňový, Contact.isTeam + clientTag + aliases, RoutingAuditLog, GoSMS modul, Things-import (částečně dořešen — 217 nedoimportovaných mailů v `Downloads/things-finale.md`)
3. `INSTRUKCE/SMART-ROUTING.md` — operativní návod jak routing nakonfigurovat a debugovat
3. `INSTRUKCE/HANDOFF-2026-05-07.md` — předchozí stav (Spíž, UPLOAD, fire-and-forget napříč)
4. `INSTRUKCE/PRO-CLAUDINE-COACHE.md` — kontext o Petrovi, filozofie systému
5. `INSTRUKCE/00-START-HERE.md` — vstup, pravidla
6. `INSTRUKCE/05-styl-prace.md` — komunikace
7. `INSTRUKCE/03-moduly.md` — moduly, URL, status (aktualizováno 2026-05-10)
8. `INSTRUKCE/04-todo-list.md` — manuální DSM akce
9. `HANDBOOK.md` — referenční doc (sekce „Stav 2026-05-10" v hlavičce)

**Tento CLAUDE.md je z dubna 2026 a v některých detailech zastaralý** — `HANDOFF-*.md` jsou freshest.

Starší HANDOFFs (zaarchivovány, nečíst pro orientaci):
- `INSTRUKCE/HANDOFF-2026-05-02-vecer.md`
- `INSTRUKCE/HANDOFF-2026-05-03.md`
- `INSTRUKCE/HANDOFF-2026-05-04.md`
- `INSTRUKCE/HANDOFF-2026-05-06.md`
- `INSTRUKCE/HANDOFF-2026-05-07.md`
- `INSTRUKCE/HANDOFF-bwmys-viz.md` (B&W myš vizualizace, dokončeno)

---

## Kontext (původní zápis duben 2026)

- **Majitel:** Petr Perina (jediný uživatel systému)
- **Repo name:** `raseliniste` (GitHub)
- **Produkční doména:** https://www.raseliniste.cz
- **Deploy target:** Synology DS718+ (linux/amd64) přes Container Manager
- **Jazyk komunikace s uživatelem:** čeština

## Stack (rozhodnuto)

- **Astro 6** (`output: "server"`, `@astrojs/node` adapter v `mode: "standalone"`) + TypeScript
  - Pages v `src/pages/**.astro`, API endpointy v `src/pages/api/**.ts`
  - React integration pro interaktivní islands (LoginForm, LogoutButton, budoucí AI chat UI)
  - **Historická poznámka:** původně Next.js 16 → opuštěno kvůli bugu s prerenderem interních error stránek (`useContext = null`, issues #86965/#92839/#83784), který se reprodukoval i v Next 15.5.7 a canary. Astro build projde čistě za ~1 s.
- **Prisma + PostgreSQL** — druhý kontejner podle deploy patternu
- **Design system:** Tailwind v4 + shadcn-style tokeny (OKLCH v `src/styles/global.css`) + vlastní glass utility (`.glass`, `.glass-strong`, `.glass-subtle`)
- **Vizuální jazyk:** Liquid Glass (Apple VisionOS-inspirovaný) — dark-only, půlnoční modré pozadí s pastelovými radial blobs, glass panely s `backdrop-blur-24px`
- **Typografie:** Fraunces Variable (serif nadpisy), Geist Variable (body), Geist Mono Variable (datumy/ID) — vše přes `@fontsource-variable/*`
- **Ikony:** Lucide (Astro: `astro-icon` + `@iconify-json/lucide`; React: `lucide-react`)
- **UI primitives:** vlastní v `src/components/ui/` (Button s CVA varianty, Input) — pattern podle shadcn/ui, ne CLI instalace
- **Nativní HTML formuláře** — `<input>`, `<select>`, `<textarea>`, `<input type="date">`, `<input type="file">` stylované našimi Input/Button komponentami (mobilní UX zachována)
- **@google/genai** — Gemini API (model: `gemini-2.5-pro`, fast: `gemini-2.5-flash`), klíč **jen server-side**
- **Auth:** custom, single-user, max security
  - argon2 password hash
  - jose JWT v HTTP-only cookie, `sameSite: strict`, `secure` v produkci
  - rate limit na login (5 fails/15 min per email, 20 per IP)
  - session record v DB, 7denní TTL
- **zod** pro validaci API vstupů

## Klíčová rozhodnutí (nelámat bez konzultace s Petrem)

### Design: Liquid Glass (shadcn + Tailwind v4 + glass)
- **Pozadí:** fixed radial gradients v 3 pastelových "blobs" (peach/lavender/sky) nad `--background` (hluboká půlnoční modř `oklch(14% 0.025 260)`). Viz `body { background: ... }` v `src/styles/global.css`.
- **Glass povrchy:** 3 úrovně utility: `.glass-subtle` (jemný hint), `.glass` (defaultní karta), `.glass-strong` (modály, login). Všechny používají `backdrop-filter: blur(..) saturate(..)`, bílý tint 4.5–8 %, 1 px bílý border s inset glow + dramatický box-shadow.
- **Tokeny:** shadcn-style proměnné (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`, atd.) + pastelová paleta `--tint-peach/mint/lavender/sky/sage/butter/rose/pink`, namapované do Tailwind v4 přes `@theme inline`.
- **Kontrast je must-have** — Petr je starší a hůř vidí. Foreground text 98 %, muted 78 %, žádné < 70 % na hlavních prvcích.
- **Každý modul má svůj pastelový tint** (sidebar ikony, KPI karta, badge v tabulce). Pořadí: úkoly=peach, poznámky=mint, deník=butter, kalendář=sky, kontakty=lavender, finance=sage, AI=rose, soubory=pink.
- **Testovat na reálném telefonu** po každé větší změně layoutu. Sidebar je off-canvas pod `lg` breakpoint (`SidebarToggle` React island).
- **Nativní formulářové prvky** (`<input type="date">` atd.) — mobilní picker zachován.
- **Nepřidávat**: hand-drawn/sketchy efekty (rough.js) — 4 pokusy zamítnuty.

### Bezpečnost
- Petr požaduje **maximální zabezpečení** (jediný user, citlivá osobní data).
- Gemini API klíč **NIKDY** nesmí jít na klienta — vždy proxy přes `/api/ai/*` server routes.
- HTTP headers jsou nastaveny v `next.config.ts` (HSTS, X-Frame-Options: DENY, atd.).
- Budoucí vylepšení: WebAuthn/passkey místo hesla, TOTP 2FA.

### Deploy
- **Plný návod v `SYNOLOGY_DEPLOY_PATTERN.md`** (kopie v kořeni repa).
- GitHub Actions → ghcr.io → Synology Container Manager.
- Image **public** (repo může zůstat private) — odpadá PAT na NAS.
- Postgres jako **druhý kontejner** v compose, data v named volume.
- DSM Reverse Proxy řeší HTTPS (Let's Encrypt).
- Port aplikace: **3333** (ne 3000 kvůli kolizi s DSM i lokálním dev serverem).

## Struktura

```
raseliniste/
├── src/
│   ├── pages/
│   │   ├── index.astro        — dashboard (chráněný)
│   │   ├── login.astro        — login stránka
│   │   └── api/
│   │       ├── auth/{login,logout,me}.ts  — auth endpointy
│   │       └── ai/chat.ts     — Gemini chat endpoint
│   ├── layouts/
│   │   └── Base.astro         — root layout s PaperCSS <link>
│   ├── components/            — React islands (LoginForm, LogoutButton, …)
│   ├── lib/
│   │   ├── db.ts              — Prisma lazy singleton (adapter-pg)
│   │   ├── env.ts             — zod-validated env (lazy Proxy)
│   │   ├── session.ts         — JWT cookie session (Astro Cookies API)
│   │   ├── rate-limit.ts      — login rate limiting
│   │   └── gemini.ts          — Gemini client
│   ├── middleware.ts          — auth proxy + security headers
│   └── generated/prisma/      — vygenerovaný Prisma klient (gitignored)
├── prisma/schema.prisma       — User, Session, LoginAttempt
├── prisma.config.ts           — Prisma 7 konfigurace (datasource.url runtime)
├── astro.config.mjs           — Astro config, Node adapter, React integration
├── Dockerfile                 — multi-stage (deps, prod-deps, builder, runner)
├── docker-entrypoint.sh       — chown → heal → migrate → `node dist/server/entry.mjs`
├── docker-compose.yml         — app + postgres pro NAS (port 3333:3000)
├── docker-compose.dev.yml     — jen Postgres pro lokální vývoj (port 5433)
├── .github/workflows/         — docker-build.yml
├── .env.example / .env.local  — šablona / lokální secrets
└── SYNOLOGY_DEPLOY_PATTERN.md — referenční deploy návod
```

## Moduly (roadmap)

- **v1 (kostra):** auth, dashboard shell, Gemini chat endpoint, UI test stránka
- **v2+:** Petr specifikuje postupně (úkoly, poznámky, deník, kontakty, finance, …)

## Konvence pro Claude

- Odpovídej **česky**, stručně. Petr preferuje přímou komunikaci bez vaty.
- **Neprogramuj dopředu** — nepřidávej abstrakce/features, které Petr nechtěl.
- Před riskantními akcemi (`git push --force`, `rm -rf`, drop DB) se **vždy ptej**.
- Před nasazováním nových věcí konzultuj dopad na mobilní UX.
- Gemini modely volej přes `src/lib/gemini.ts`, nikdy ne přímo z komponent.

## Stav scaffoldu (k datu 2026-04-19)

**Hotovo:**
- Next.js 16 + TS + Tailwind v4 projekt
- Závislosti: wired-elements, lit, @prisma/client, @google/genai, argon2, jose, zod, prisma (dev), tsx (dev)
- `prisma/schema.prisma` — User, Session, LoginAttempt
- `src/lib/{db,env,session,rate-limit,gemini}.ts`
- `src/app/api/ai/chat/route.ts` (POST, auth-protected)
- `next.config.ts` — standalone output + security headers

**Zbývá dodělat:**
- wired-elements client wrapper (`src/components/Wired.tsx` — loader Web Components jen na klientu)
- Login stránka + `/api/auth/login` + `/api/auth/logout`
- Dashboard (chráněný)
- `/ui-test` — testovací stránka pro mobil
- Dockerfile + docker-entrypoint.sh + .dockerignore
- docker-compose.yml + .env.example
- `.github/workflows/docker-build.yml`
- Scripts: `prisma/seed` pro první admin user, `scripts/heal-migrations.mjs`
- README-DEPLOY.md (user-facing návod pro Synology setup)

## Tip pro pokračování

Pokud navazuješ v nové session, začni:
1. Přečíst tento CLAUDE.md a `SYNOLOGY_DEPLOY_PATTERN.md`
2. `git status` a `ls src/` pro aktuální stav
3. Zeptat se Petra, co má prioritu ze seznamu "Zbývá dodělat"
