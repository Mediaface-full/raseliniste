# Rozhodnutí & kontext — Rašeliniště

> Proč jsou věci tak jak jsou. **Toto je nejdůležitější soubor pro pochopení
> projektu.** Bez tohoto kontextu nová session bude navrhovat změny které
> dávají smysl obecně ale jsou špatné pro tento konkrétní projekt.

## Zásadní rozhodnutí

### Astro 6 SSR (ne Next.js, ne SPA)

**Proč**: Původně Next.js 16 → opuštěno kvůli bugu s prerenderem interních
error stránek (`useContext = null`, issues #86965/#92839/#83784).
Reprodukováno i v Next 15.5.7 a canary. Astro build projde čistě za ~1 s.

**Trade-off**: Ztratili jsme některé Next.js featury (Server Actions,
streaming, Image optimization), ale zisk ve stabilitě a buildu stál za to.

### Single-user (jen Gideon)

**Proč**: Petr je jediný uživatel systému. Jeho osobní informační systém,
ne SaaS. Auth je single-user, žádné role, žádné teams.

**Důsledek**: V kódu nikde nemáme `userId` filtering jako security boundary
— max security úprava DB query je jen `WHERE userId = session.uid`.
**Public stránky (Studánka host, Spíž, booking) mají vlastní token-based
auth modely** (GuestUser, ProjectInvitation, BookingInvite).

### Postgres + pgvector (ne SQLite, ne Pinecone)

**Proč**:
- Real DB pro produkci (replikovatelná, pg_dump zálohy)
- pgvector = jednoduchý vector store bez externí služby
- Druhý kontejner v compose = zero externí dependence
- pg 16 + pgvector 0.8.2 v Docker image `pgvector/pgvector:pg16`

**Trade-off**: vector search není tak optimalizovaný jako Pinecone/Qdrant,
ale pro Petrovu velikost dat (jednotky GB) je to dost.

### Synology NAS (ne Hetzner, ne Vercel)

**Proč**:
- Petrova soukromá data (deníky, kontakty, finance) **nesmí** ležet
  v cloudu třetí strany
- NAS má lokální backup + rsync na druhý NAS (off-site)
- DSM Reverse Proxy řeší HTTPS (Let's Encrypt automatic renewal)
- Žádné měsíční poplatky za hosting

**Trade-off**: Domácí internet (asymmetric upload), občasné výpadky proudu.
Pro single-user OK, pro produkci pro klienty by to nestačilo.

**KRITICKÉ**: Rašeliniště běží na **Synology DS718+**, ne na `diego`/Hetzneru.
SSH alias `diego` v `~/.ssh/config` je pro Mediaface projekty
(Hlídač TK), **NEMÁ co dělat s Rašeliništěm**. Viz memory
`feedback_completeness_lesson.md`.

### Liquid Glass design (ne Material, ne shadcn default)

**Proč**: Apple VisionOS-inspirovaný design — Petr má rád glass/blur
estetiku, dark-only, pastelové accent barvy. **4× zamítnuto** hand-drawn /
sketchy efekty (rough.js) — Petr je nechce.

**Trade-off**: backdrop-filter má perf overhead na slabších zařízeních
(Petrův iPhone OK). Plus láme containing block pro `position: fixed` →
modaly/tooltipy v kalendáři musí jít přes React Portal (`createPortal`
do `document.body`). Viz `feedback_calendar_fixed_positioning.md`.

### Cron dispatcher (ne DSM Task Scheduler s 15 úlohami)

**Proč**: DSM Task Scheduler má clunky UI. 15+ úloh by se v něm spravovalo
peklo. Místo toho **jedna úloha v DSM volá `/api/cron/scheduler`**, který
si dispatchuje vše dle `CRON_JOBS` v `src/lib/cron-schedule.ts`.

**Důsledek**: Pro novou cron úlohu = endpoint + záznam v `cron-schedule.ts`,
**ŽÁDNÉ DSM změny**. Viz memory `feedback_cron_dispatcher_pattern.md`.

### Velké feature dávky v jednom commitu

**Proč**: Petr 2026-05-18 frustrovaný že Cesta B rozsekána na 5 commitů.
Každý commit = push + GH Actions (~5 min) + DSM Pull + Recreate (~3 min)
× 5 = **hodina deploy overhead**.

**Pravidlo**: Velká feature v jednom commitu. Diagnostické endpointy s
`?action` param (no side effects default). Rate-limit volání 3rd party API.

Viz memory `feedback_one_dose_vs_iterations.md`.

### Fire-and-forget AI pipelines

**Proč**: Stage 2 AI analýza (audio transcript → extract úkolů, journal
summary, atd.) trvá 5-30 minut. Synchronous request by timeoutoval.

**Pattern**:
1. POST endpoint vytvoří DB záznam s `status: "processing"`
2. Vrátí 200 OK okamžitě
3. **Module-level `Set<InFlight>`** drží Promise reference proti GC
4. Frontend polluje à 4-5s tichý (`load(false)` pattern bez spinneru)
5. Po dokončení Promise.then() aktualizuje DB → polling vidí změnu

**Pozor**: Žádný spinner v UI! Petr 2026-05-07: „točící se kolečko =
matoucí, můžu odejít?". Místo toho ukázat záznam hned s placeholder.

Viz `feedback_no_processing_spinner.md` + `todo_studna_async_still_failing.md`.

### Tichý audit log (RoutingAuditLog)

**Proč**: Smart routing (Task → Todoist project/section) má 6 úrovní
fallback. Když AI rozhodne špatně, Petr potřebuje vědět **proč**.

**Pattern**: Každý routing krok loguje do `RoutingAuditLog`:
- `taskId`, `decidedProjectSlug`, `decidedSectionSlug`, `reason`
- `level` (1-6 = která úroveň fallback sedla)
- `aiResponse` (raw AI output) — pro forensic debug

UI v `/settings/crons` table audit logu posledních 50.

## Co bylo zkoušeno a nefunguje

### Things-import 100% (zůstává ~217 nedoimportovaných)

**Pokus**: Things.app export → parse → vytvořit Tasks v Todoist
**Problém**: Things má vlastní hierarchii (Areas/Projects/Headings),
duplicitní úkoly napříč projekty, nekonzistentní datum formáty.
**Stav**: 80% importováno automaticky, ~217 zbývá v `Downloads/things-finale.md`
pro manuální triage.

### iOS Add to Home Screen — orange ikona

**Pokus**: 5 iterací změny PWA ikony /start na orange Gide-on
**Problém**: iOS 18+ Dark/Tinted home screen mode auto-tintuje PWA
ikony. PWA nemůže dodat dark variantu (Apple limit, jen native apps
přes Asset Catalog).
**Workaround**: Použít **dark-by-design** ikonu (`icon-ink` variant —
tmavé bg + cream G + orange toggle). iOS auto-tint má pak co tintovat
konzistentně.

Viz `feedback_ios_pwa_icons.md`.

### Rough.js hand-drawn UI

**4× zamítnuto** Petrem. Před další iterací: **zeptat se co konkrétně
vadí**.

### Things z Pošty (iCloud Mail import přes IMAP)

**Pokus**: Importovat starou iCloud poštu přes IMAP do `/posta`
**Problém**: iCloud blokuje 3rd party IMAP klienty s app-specific
heslem, plus 30k+ mailů by sežralo db+token kvótu.
**Rozhodnutí**: Jen forward future emails na Petrovu Gmail adresu
co máme přes OAuth.

### Patalogické pokusy o opravu „spinner OK only on foreground operations"

Spinner je OK jen pro krátké foreground akce (upload bytes, login,
search). Pro fire-and-forget pipelines (AI analysis, sync) **žádný
spinner** — ukázat záznam hned s placeholder + tichý polling.

## Záměrné kompromisy

### Pre-existing TS errors v PushSettings.tsx

`Uint8Array` typing + `class` vs `className` warnings.
**Runtime OK**, jen TS linter naříká. Petr ví, fix až bude čas.

### Žádný TanStack Query / SWR

Manuální `fetch` + `useEffect` + `useState`. Pro malý projekt single-user
overkill přidávat dalších 30kb knihovny. **Polling** stačí.

### Žádné websockets

Petr nepotřebuje real-time napříč zařízeními. 4-5s polling tichý
je dostatečný.

### iCloud sync přes CalDAV/CardDAV bez npm knihovny

`tsdav` je jen base HTTP layer. **Vlastní implementace vCard 3.0 parser +
serializer** v `src/lib/carddav.ts` kvůli Apple specifickým quirkům:
- Default XML namespace `DAV:` (ne `D:`)
- Numeric HTML entities `&#13;` (ne `&#x0D;`)
- UID rotation při změnách
- ETag-based optimistic concurrency

Trade-off: 700+ řádků vlastního kódu, ale plně pod kontrolou.
Viz `feedback_carddav_xml_entities.md`.

### Auto-cleanup audio po 14 dnech

Audio soubory zabírají hodně místa. Cleanup cron à 3:00 maže:
- **STANDARD** audio po 14 dnech POKUD: ne-Prskavka, ne-pinned,
  host bez `keepAudio`
- **Nikdy se nemažou**: Prskavka, BRIEFy, `isPinned`, `keepAudio=true`,
  UPLOAD type

Transkripty + analýza **zůstávají vždy**. Viz `project_audio_retention_rules.md`.

## Otevřené otázky

### Push notifikace persistance napříč VAPID rotacemi

VAPID je one-time setup. Pokud Petr přepíše VAPID klíče, všechny
subscriptions umřou (Web Push protokol váže endpoint na public key).
**Lesson** (2026-06-01): VAPID **neměnit** dokud nejsou skutečné
security důvody.

### WebAuthn passkey

Model existuje, UI částečně rozpracované. Když? **Až bude čas.**

### POSTA fáze 7 (mobile inbox + AI reply)

Naplánováno na příští velkou session, 4-6 hodin. Detail v
`INSTRUKCE/POSTA-PHASE-7-PLAN.md`.

### SMTP2GO DKIM (po migraci ze Seznam)

Po migraci 2026-05-27 přes admin „Verified" = funkční DKIM podle SMTP2GO.
Z `dig` z lokálu CNAME nezobrazuje — interní validace SMTP2GO postačí.
Petr opravil můj omyl 2026-05-27.

## Historie důležitých změn

| Datum | Změna | Proč |
|-------|-------|------|
| 2026-04-19 | Scaffold projektu (Astro 6 SSR) | Po opuštění Next.js 16 |
| 2026-04-30 | RAG (`/zeptat-se`) + pgvector | Semantic search nad deníky |
| 2026-05-02 | Todoist obousměrný sync | Petr pracuje v Todoist mobilu |
| 2026-05-05 | iCloud Calendar (CalDAV) | RODINA kalendář v jednom UI |
| 2026-05-07 | Spíž + UPLOAD recordings | Sdílení souborů + audio nahrávání |
| 2026-05-10 | Smart routing 6-úrovňový + Alias systém | „Karel = TK = Tékáčko" |
| 2026-05-13 | Pošta (Email Intelligence) modul kompletní | F1-F6 |
| 2026-05-14 | iCloud CardDAV sync kontaktů | Overlay model (core + Rašeliniště) |
| 2026-05-16 | Kontakty modul F1-F8 + 17 polish | Polish day |
| 2026-05-17 | Booking modul HOTOVÝ | Token-based pozvánky |
| 2026-05-18 | Todoist Team Workspace (Cesta B) | Foldery + collaborators |
| 2026-05-20 | Timeline View modul (F1-F5) | Drag canvas + share + PDF |
| 2026-05-27 | Big day (~26 commitů): booking polish, /ukoly Triage, audio žádný strop, push notifikace cron, 26-bodový dashboard feedback | Konsolidace |
| 2026-05-27 | Page Links modul | User-defined sidebar shortcuts |
| 2026-06-01 | Pošta blacklist + PWA Gide-on ikona + VAPID rotation + push notifikace live | Iterace na detailech |
| 2026-06-09 | Triage picker projektu (manuální override Smart routing) + Team Workspace routing pravidlo #3 + Portal pattern audit | Petr právem vytkl že tyto měly být hotové dřív (2026-05-10 Smart routing, 2026-05-18 Cesta B, 2026-05-05 Portal pattern) |

## Nová pravidla od 2026-06-09

### Každý AI-driven decisioning krok MUSÍ mít UI override

Z `feedback_smart_routing_needs_escape.md`:

> Pro **každý AI-driven automatický rozhodovací krok** musí být v UI
> možnost manuálního overridu. **Žádné výjimky.** Nejde o vzájemnou
> nedůvěru — jde o respekt k uživateli který zná kontext lépe než AI.

Aplikace pravidla:
- Task Triage projekt → ✅ ProjectPicker chip 📁 (2026-06-09)
- Task Triage kontakt → ✅ kontakt dropdown (2026-05-27)
- Pošta urgent/normal klasifikace → ⏳ AUDIT
- Booking slot AI suggestion → ⏳ AUDIT
- Studánka AI summary → ⏳ AUDIT
- Deník @lidé + #tagy extract → ⏳ AUDIT

### Routing pravidla refaktor = projít VŠECHNA pravidla

Z `feedback_team_workspace_routing_gap.md`:

> Když refaktoruju routing logiku (např. Cesta B Team Workspace), MUSÍM
> projet VŠECHNA pravidla, ne jen ta která se zjevně týkají nového featuru.

Cesta B (2026-05-18) updatovala pravidla #1 a #2 (klient-* tag). Pravidlo
#3 (`isTeam`) zůstalo hardcoded, fixed až 2026-06-09. Tento gap stál
3 týdny živé bug v produkci.

### Memory čtení **PŘED** kódem, ne po

Z `feedback_smart_routing_needs_escape.md`:

> Před každou změnou v UI / routing / AI prompt: **grep memory soubory
> aktivně** na téma (`portal`, `dropdown`, `workspace`, `routing`,
> `prompt`, `transcript`).

Důvod: 2026-06-09 jsem 3× porušil pravidlo:
- Portal pattern v memory od 2026-05-05 → ignoroval při ProjectPicker
- Team Workspace routing #3 gap v memory implicit → nepřipomněl si
- AI prompt z reálných transkriptů → psal anglickou logikou ze stolu
