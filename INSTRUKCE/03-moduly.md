# 03 — Moduly (přehled)

Stav 2026-05-02. Detail jednotlivých modulů v `Návody/*.pdf`.

## 🌅 Vstupní stránka

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Start** | `/start` | ✅ | Sjednocená vstupní stránka pro mobil. PWA ikona **strom** (samostatný `/tree-touch-icon.png`, JEN pro Petra). Nahoře svátek + narozeniny z kontaktů. 4 dlaždice: Deník, Úkoly, Studna, Zeptat se. Pod nimi tlačítko Dashboard přes celou šířku. Layout zarovnán nahoru (žádné scrollování na mobilu). |
| Dashboard | `/` | ✅ | KPI karty, aktivita, sekce „Plán" (nejbližší 3 dny + porušení pravidel). |
| **Zeptat se (RAG)** | `/zeptat-se` | ✅ NOVÉ 04-30 | AI dotaz nad indexovanými deníky / úkoly / Studna nahrávkami. pgvector + Gemini text-embedding-004 (768 dim) + Gemini 2.5 Pro generování s [N] citacemi. Auto-indexace nových zápisů. Backfill záměrně neproveden — Gideon chtěl „jen od teď". Lib `src/lib/rag.ts`. |
| **B&W Myš** (rozhodovací linka) | `/bwmys` | ✅ NOVÉ 05-01 + vizualizační vrstva 05-02 | Strukturovaný rozhodovací systém pro emocionální rozhodovací styl. Longitudinální sběr vstupů (default 14 dní) → AI vyhodnocení (sekce A-H) → uzavírací verdikt + „co by ho překlopilo". Spec: `/Users/petrperina/Downloads/rozhodovaci-system-zadani.md` + vizualizace `/Users/petrperina/Downloads/rozhodovaci-system-vizualizace.md`. Modely: `Decision`, `DecisionEntry`, `DecisionEvaluation` (+ `argumentsJson`), `DecisionReopening`. AI lib: `src/lib/bwmys-ai.ts` (5 promptů — varianty, mini, finální, klasifikace úhlů, **extrakce argumentů**). Audio nahrávání zápisu (Stage 1 přepis + Stage 2 extrakce metadat). Cron `bwmys-tick` denně 7:10. **Vizualizační vrstva (05-02):** `src/components/BwMysViz/` — Six Hats radar (Recharts), křivka nálad (s tooltipem), donut typů, **mřížka argumentů (ScatterChart smer × konzistence, velikost dle četnosti)**. Sdílené barvy v `src/lib/bwmys-colors.ts`. Endpoint `/api/bwmys/[id]/arguments` (cache do `argumentsJson`, `?force=1` regenerace). Ikona dvě myšky v yin-yang (`bwmys-touch-icon.png`). |

## 🎙️ Audio / hlasové zápisy

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Ozvěna** (úkoly+deník) | `/ozvena` | ✅ | Sjednocený diktát, přepínač Úkoly/Deník. URL `?mode=task` nebo `?mode=journal` přepne. PWA „Ozvěna" (legacy, stále funkční). |
| Studna nahrávka | `/studna/nahravka` | ✅ | Owner recorder pro Gideona. **Výběr projektu = grid dlaždic** (dříve dropdown), localStorage pamatuje poslední. |
| Studna inline | `/studna/<id>` | ✅ | Recorder rovnou v detail projektu (bez dropdownu). |
| Studna guest | `/me/<token>` | ✅ public | Klienti / hosti nahrávání, token v URL, rate limit 20/h/host. |

**Wake Lock + visibility ochrana** = ve VŠECH 4 recorderech (commit `c649dd6`). Banner před start, indikátor během, varování po stop pokud audio nesedí.

## ✓ Úkoly (samostatný Task model)

| Modul | URL | Status |
|---|---|---|
| Hlavní | `/ukoly` | ✅ |
| Audio review | `/ukoly/audio/<batchId>/review` | ✅ |

- Manuální create + edit + delegate + push do Todoistu
- Filtry: status (open/done/all), assignee (me/all/per kontakt), tagy
- **Smart Todoist routing pro delegaci:** top-level projekt jménem assignee → projekt „Lidé" → sekce jménem assignee (vytvoří automaticky)
- Audio diktát: Vertex Pro extrakce úkolů z přepisu, review screen pro schválení

**Capture inbox** (`/tasks`) = legacy Entry-based, zachováno paralelně.

## 📓 Deník (samostatný JournalEntry model)

| Modul | URL | Status |
|---|---|---|
| Hlavní list | `/denik` | ✅ |
| Detail/edit | `/denik/<id>/edit` | ✅ |
| **Měsíční review** | `/denik/review/YYYY-MM` | ✅ |

- Hlasový (přes Ozvěna) + textový vstup
- AI strukturuje dle Gideonova promptu (CPTSD/ADHD-aware, METADATA + tělo + POZNÁMKY EDITORA, NÁPADY extrakce)
- **Vyhledávání:** fulltext (bodyMarkdown + transcript + title) + filtry (lidé z LIDÉ, tagy z TÉMATA, datum, mood)
- **Měsíční review:** Vertex Pro pracuje JEN s METADATA + POZNÁMKY EDITORA (tělo nečte) — vzorce, vývoj, lidé, nedořešené nitky
- Identifier `denik_RRRR-MM-DD` v UI + tlačítko Stáhnout `.txt`
- Audio retention 7 dní (`audioRetainForever` toggle ho zachová navždy)

**Journal (legacy)** (`/journal`) = původní Entry-based deník z Capture, zachováno paralelně.

## 📅 Kalendář (komplet)

| Modul | URL | Status |
|---|---|---|
| Hlavní pohled | `/calendar` | ✅ |
| Quickadd (hlas/text) | `/quickadd` | ✅ |
| Den (briefing + DayNote) | `/day/<YYYY-MM-DD>` | ✅ |
| Pozvánka | `/calendar/invite` | ✅ |
| Klient pozvánka | `/i/<token>` | ✅ public |
| Cold lead | `/schuzka` | ✅ public |
| Dovolená/nomád | `/calendar/away` | ✅ |
| Lokace | `/calendar/locations` | ✅ |
| Settings Google | `/settings/integrations/google` | ✅ |
| Settings iCloud | `/settings/integrations/icloud` | ✅ |

- 18 pravidel (HARD/WARNING/INFO) v `lib/rules-config.ts`
- Sync Google + iCloud syn (RODINA) + iCloud partnerka (S & P) à 5 min
- Bookingy s magic-link confirm + smart slot listing
- Noční briefing 22:00 → Todoist (cron)
- OOO management vytvoří v Google all-day event s `eventType: outOfOffice`

## 🌊 Studna (sdílené projektové boxíky s audio)

| Modul | URL | Status |
|---|---|---|
| Hlavní list projektů | `/studna` | ✅ Tlačítko **Aktivita** v hlavičce vedle Nahrávat / Nový projekt. |
| **Aktivita (přehled nahrávek)** | `/studna/aktivita` | ✅ NOVÉ 04-30 Posledních 200 záznamů sgrupovaných per den (Dnes / Včera / weekday + datum). Karta = autor + badge (Já / Brief / status) + relativní čas + projekt + 200znakový náhled. |
| Detail projektu | `/studna/<id>` | ✅ |
| Owner nahrávka | `/studna/nahravka` | ✅ Grid dlaždic + localStorage poslední projekt |
| Guest landing | `/me/<token>` | ✅ public |

- 4 záložky v detail: Záznamy, Hosti, Souhrny, Nastavení
- STANDARD (Flash, max 10 min) vs BRIEF (Pro, max 90 min, file upload)
- Two-stage AI pipeline: transcript + analysis (klíčová témata, myšlenky, otevřené otázky, sentiment)
- BRIEF má navíc glossary, actors, decision_history
- Auto-retry stuck recordings cron à 15 min
- Manuální „Regenerovat" tlačítko pro každý záznam

## ⚙️ Settings (sjednocené pod /settings landing)

| Modul | URL | Status |
|---|---|---|
| Landing s dlaždicemi | `/settings` | ✅ |
| Google integrace | `/settings/integrations/google` | ✅ |
| iCloud integrace | `/settings/integrations/icloud` | ✅ |
| Todoist integrace | `/settings/integrations` | ✅ |
| E-mail (SMTP) | `/settings/reports` | ✅ |
| iPhone Shortcuts | `/settings/shortcuts` | ✅ |
| Health Auto Export | `/settings/ingest` | ✅ |
| API tokeny | `/settings/tokens` | ✅ |
| Odesílatelé dopisů | `/settings/letter-senders` | ✅ |
| **AI prompty** | `/settings/ai-prompts` | ✅ NOVÉ |
| **AI náklady** | `/settings/ai-usage` | ✅ NOVÉ |

**Sidebar má jen 1 položku „Nastavení"** → otevře `/settings` landing s 4 sekcemi dlaždic (Integrace, Mobilní zařízení, Obsah a šablony, AI). Plus aktivní ozubené kolečko vpravo nahoře v topbaru.

## 📞 Firewall + Dopisy + ostatní

| Modul | URL | Status |
|---|---|---|
| Kontakty | `/contacts` | ✅ Pole pro narozeniny (birthMonth+birthDay) + 5. pád (firstNameVocative) — manuální override pro VIP oslovení. |
| Firewall historie | `/firewall` | ✅ U VIP vzkazů s vyplněným termínem rose badge „📅 do DD. M. RRRR". |
| **Veřejné submit (Firewall)** | `/call-log` | ✅ public **DVĚ varianty** — NONVIP_TEXTS / VIP_TEXTS jako konstanty v souboru. VIP detekce přes `?phone=` v URL → DB lookup. VIP má: 5. pád oslovení, datum splnění (volitelné, type=date, min +2 dny → Todoist `due_date`), texty „Gíďo, máš misi" / „Vypusť Gíďu". Ne-VIP: „Gideon teď nezvedá". |
| Thanks | `/call-log/thanks` | ✅ public Detekuje VIP přes `?phone=`. VIP: „Mise vypuštěna ✦" + tlačítko „Zadej další misi" + **sekce „Giďoušovy mise"** (otevřené nahoře, sbalitelné Hotové za 14 dní; mise zmizí automaticky když je Gideon odškrtne v Todoistu). On-demand Todoist sync pokud >5 min od posledního. Ne-VIP: „Vzkaz doručen". |
| **Todoist obousměrný sync** | cron `todoist-sync` | ✅ NOVÉ 05-02 | **Pull z Todoistu zpět do DB** (každých 30 min + on-demand z thanks). Todoist je zdroj pravdy: odškrtnutí/smazání → propíše se do `Task.completedAt` a `CallLog.seenAt` (VIP výpis). Nové úkoly přidané přímo v Todoist appce → vytvoří se `Task` se `source=todoist_pull`. Per-user incremental přes Sync API + `User.todoistSyncToken`. Lib `src/lib/todoist-sync.ts`, endpoint `/api/cron/todoist-sync`. |
| Dopisy | `/letters` | ✅ |
| Editor dopisu | `/letters/<id>` nebo `/letters/new` | ✅ |
| Zdraví | `/health` | ✅ |
| Capture/Triage | `/capture`, `/triage` | ✅ |
| Poznámky | `/notes` | ✅ |

## 🔧 Diagnostika

| Endpoint | Účel |
|---|---|
| `/api/health/ai` | Test ping na Gemini + mode info |
| `/api/diagnose/studna` | Stav recordings + in-flight + audio na disku + AI errors za 24h + env health + auto-vyhodnocení |

**Když Gideon hlásí problém s audio/Studna**, **první krok**: otevřít `/api/diagnose/studna` v prohlížeči, JSON má pole `conclusions` co řekne kde to vázne.
