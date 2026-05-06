# 03 — Moduly (přehled)

Stav 2026-05-06 (Studánka keepAudio + výpis 5 záznamů pro hosta + Prskavka audio retention). Detail jednotlivých modulů v `Návody/*.pdf`.

## 🌅 Vstupní stránka

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Start** | `/start` | ✅ AKT 05-03 | Sjednocená vstupní stránka pro mobil. PWA ikona **strom** (samostatný `/tree-touch-icon.png`, JEN pro Petra). Nahoře svátek + narozeniny z kontaktů. **8 dlaždic** (Mise, Deník, Úkoly, Studánka, Prskavka, Zeptat se, ŽIJEŠ?, Myši) — bez popisků, jen ikona+titul, kompaktní `min-h-[96px]`, 2 sloupce. Každá dlaždice unikátní pastelový tint. **Custom ikony** přes `Fragment set:html` z `src/assets/icons/*.svg` (Myši, Mise raketa). Pod dlaždicemi tlačítko Dashboard přes celou šířku. Layout zarovnán nahoru. |
| **Mise** (today view PWA) | `/dnes` → redirect `/day/<dnešní>` | ✅ NOVÉ 05-03 | Server-side redirect na aktuální den — Petr může přidat `/dnes` na plochu mobilu, vždy se otevře dnešek (ne datum, kdy se ikona vytvořila). Cílí na DayView pod Shellem. PWA s vlastním manifestem + raketkovou ikonou je TODO. |
| Dashboard | `/` | ✅ | KPI karty, aktivita, sekce „Plán" (nejbližší 3 dny + porušení pravidel). |
| **Zeptat se (RAG)** | `/zeptat-se` | ✅ NOVÉ 04-30 | AI dotaz nad indexovanými deníky / úkoly / Studna nahrávkami. pgvector + Gemini text-embedding-004 (768 dim) + Gemini 2.5 Pro generování s [N] citacemi. Auto-indexace nových zápisů. Backfill záměrně neproveden — Gideon chtěl „jen od teď". Lib `src/lib/rag.ts`. |
| **B&W Myš** (rozhodovací linka) | `/bwmys` | ✅ NOVÉ 05-01 + vizualizační vrstva 05-02 + Decision Compass 05-06 | Strukturovaný rozhodovací systém pro emocionální rozhodovací styl. Longitudinální sběr vstupů (default 14 dní) → AI vyhodnocení (sekce A-H) → uzavírací verdikt + „co by ho překlopilo". Spec: `/Users/petrperina/Downloads/rozhodovaci-system-zadani.md` + vizualizace `/Users/petrperina/Downloads/rozhodovaci-system-vizualizace.md`. Modely: `Decision`, `DecisionEntry`, `DecisionEvaluation` (+ `argumentsJson`), `DecisionReopening`. AI lib: `src/lib/bwmys-ai.ts` (5 promptů — varianty, mini, finální, klasifikace úhlů, **extrakce argumentů**). Audio nahrávání zápisu (Stage 1 přepis + Stage 2 extrakce metadat). Cron `bwmys-tick` denně 7:10. **Vizualizační vrstva (05-02):** `src/components/BwMysViz/` — Six Hats radar (Recharts), křivka nálad (s tooltipem), donut typů, **mřížka argumentů (ScatterChart smer × konzistence, velikost dle četnosti)**. Sdílené barvy v `src/lib/bwmys-colors.ts`. Endpoint `/api/bwmys/[id]/arguments` (cache do `argumentsJson`, `?force=1` regenerace). **Decision Compass (05-06):** 5. vizualizace — custom SVG kompas se 4 kvadranty (SZ/SV silný signál PROTI/PRO konz>0.5, JZ/JV šum strach/euforie konz<0.5), barva = Six Hats klobouk, velikost = četnost, opacity/dashed = konzistence. V centru verdikt podle `decision.status` + label „opřený o sever/východ/jih/západ" (max váha = `Σ cetnost·\|smer\|`). `DecisionArgument.klobouk` přidán (optional, fallback `meta`). Spec `INSTRUKCE/zadani-decision-compass.pdf`. Detailní metodologie v `INSTRUKCE/BWMYS-METODOLOGIE.md`. Ikona dvě myšky v yin-yang (`bwmys-touch-icon.png`). |

## 🎙️ Audio / hlasové zápisy

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Ozvěna** (úkoly+deník) | `/ozvena` | ✅ | Sjednocený diktát, přepínač Úkoly/Deník. URL `?mode=task` nebo `?mode=journal` přepne. PWA „Ozvěna" (legacy, stále funkční). |
| Studna nahrávka | `/studna/nahravka` | ✅ | Owner recorder pro Gideona. **Výběr projektu = grid dlaždic** (dříve dropdown), localStorage pamatuje poslední. |
| Studna inline | `/studna/<id>` | ✅ | Recorder rovnou v detail projektu (bez dropdownu). |
| Studna guest | `/me/<token>` | ✅ public | Klienti / hosti nahrávání, token v URL, rate limit 20/h/host. |
| **Per-projekt AI prompty** (Studna/Prskavka) | `/studna/<id>` záložka Nastavení | ✅ NOVÉ 05-02 | Každý projekt může mít vlastní `studnaStandardPrompt` + `studnaBriefPrompt` — přepíše globální Stage 2 prompt jen pro daný projekt. Use case: Prskavka osobní projekty potřebují jiný typ výstupu než klientské Studna brainstormy. Priorita: per-projekt > DB global override > default v kódu. Aktivní projekty mají v hlavičce lavender banner „⚙ Tento projekt používá vlastní AI prompty". |
| **Per-projekt Gemini model** | `/studna/<id>` záložka Nastavení | ✅ NOVÉ 05-03 | `ProjectBox.analysisModel` nullable. Select v UI: Auto (default — BRIEF=Pro, STANDARD=Flash) / Flash 2.5 / Pro 2.5. Override Stage 2 modelu pro VŠECHNY analýzy v projektu (Stage 1 přepis je vždy Flash, mechanická úloha). Pro kreativní projekty (knížka, podcast) → Pro 2.5. Migrace `add_projectbox_analysis_model`. |
| **Vlastní prompt pro Souhrn projektu** | `/studna/<id>` záložka Nastavení | ✅ NOVÉ 05-03 | `ProjectBox.projectSummaryPrompt @db.Text` — přepíše hardcoded prompt v `summarizeProject` (lib `project-summary.ts`). Když vyplněn (>20 znaků), Gemini Pro dostane **PLNÉ transkripty** všech nahrávek (ne osekané `summary` + `key_themes`), temperature 0.6, maxOutputTokens 32k. Pro kreativní agregaci napříč nahrávkami (mapa kapitol, index osob s `#`, bílá místa, časová osa). Petrův pojmový mismatch z 05-03: omylem dal volnotextový „Mapa projektu" prompt do `studnaStandardPrompt` (Stage 2 per-recording, MUSÍ vrátit JSON) → recording uvázl. Růžová sekce v UI s explicitním varováním. Migrace `add_projectbox_summary_prompt`. |
| **Záchrana stuck recordings** | tlačítko „zrušit" v UI + `POST /api/studna/recordings/:id/mark-error` | ✅ NOVÉ 05-03 | Když nahrávka uvázne ve `status="processing"` (Promise umřela při restartu, Gemini vrátil neplatný JSON kvůli custom promptu, …), Petr klikne malé tlačítko **zrušit** vedle loaderu. Status → `error`, Petr může Regenerovat. Odpadá čekání 10–25 min na cron `retry-stuck-recordings`. |
| **Studna guest note** | textarea v `/me/<token>` | ✅ NOVÉ 05-04 | Volitelný textový vzkaz vedle nahrávky (URL, jména, čísla co se hlasem komolí). Není AI analyzováno. Schema: `ProjectRecording.guestNote String?`. Petr vidí v detailu recording cards (butter sekce). Default schované, "+ Přidat textový vzkaz" expanduje. |
| **Per-host „Zachovávat audio"** | `/studna/<id>` záložka Hosti | ✅ NOVÉ 05-06 | Schema: `ProjectInvitation.keepAudio Boolean default false`. Per-projekt × per-host flag. Když true, cleanup-audio cron přeskočí STANDARD audio od tohoto hosta (zůstane natrvalo). UI: checkbox `💾 Zachovávat audio` vedle `⭐ Klíčový brief` v záložce Hosti i v pozvánkovém formuláři. Migrace `add_invitation_keep_audio`. |
| **Hostův výpis 5 posledních záznamů** | `/me/<token>` (pod GuestRecorderem) | ✅ NOVÉ 05-06 | Sekce „Tvé poslední záznamy" — top 5 nahrávek hosta napříč všemi jeho projekty. Klik = inline accordion s **plným transkriptem** (NE AI analýza). Komponenta `GuestRecordings.tsx` (reusable). Datum + čas + projekt + délka + BRIEF badge. Processing/error státy zobrazené, neexpandovatelné. |
| **Prskavka audio retention** | cleanup-audio cron + DELETE endpoint | ✅ NOVÉ 05-06 | Cleanup-audio cron přeskakuje Prskavkové projekty (`project.isPrivate=true`) — audio zůstává natrvalo. Maže se jen při smazání projektu (DELETE endpoint čistí soubory). Petr je u Prskavky jediný uživatel a chce kreativní materiál uchovávat. |
| **Petrův výpis 5 záznamů Prskavky** | `/prskavka` (pod StudnaList) | ✅ NOVÉ 05-06 | Reuse komponenty `GuestRecordings` (heading „Posledních 5 záznamů"). Top 5 nahrávek napříč všemi Prskavkovými projekty Petra (isPrivate=true). |
| **Vlastní rituály** | `/settings/ritualy` | ✅ NOVÉ 05-04 | Schema `CustomRitual` + UI manager. Form: název, popis (markdown), opakování (každý den / pracovní dny / víkend / vybrané dny — checkboxy), čas, délka. Plus default 3 rituály mají editovatelné popisky (`User.ritualTemplates JSONB`). Render v Day/Week peach + dashed + ✨. Lib `src/lib/week-rituals.ts` + `src/lib/prague-tz.ts` (deterministická TZ konverze pro Praha). |
| **Výročí v kalendáři** | Day/Week/Month views | ✅ NOVÉ 05-04 | `Anniversary` tabulka jako virtuální allDay events (pink + 🕯). Lib `src/lib/anniversary-events.ts`. Vykreslení: pink allDay proužek nahoře v Day/Week, velký event v buňce v Month. Žádný propag do Google/iCloud — samostatná entita. |

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
| Den (briefing + DayNote) | `/day/<YYYY-MM-DD>` | ✅ AKT 05-04 — vertikální timeline (DayTimeline) místo seznamu řádků: barvy podle source, sloupce při overlapu, long-event jako pozadí, mezera mezi bloky, čas nahoře/název pod, sliding window, now čára, scroll-to-now, length badge, source badge podmíněně, fullscreen support. Plus rituály i výročí jako virtual events. |
| **Týden** | `/calendar/tyden` (redirect) / `/calendar/tyden/<datum>` | ✅ NOVÉ 05-04 | Desktop pohled. 7 sloupců Po-Ne, časová osa 6-23h, default+custom rituály, výročí, multi-day spans (max 2 řádky + expand), now čára vlevo v gutteru, interpretační lišta, fullscreen mód `?naplno=1`, tisk. Print CSS v `global.css`. |
| **Měsíc** | `/calendar/mesic` / `/calendar/mesic/<YYYY-MM>` | ✅ NOVÉ 05-04 | Desktop. Heatmap hustoty 5 stupňů, velké eventy jako TEXT v buňce (max 2, source-color), rituály ✨ v rohu, hover tooltip (200ms fade) s plným seznamem, aktuální týden inset, fullscreen, tisk. „Květen 2026" v nominativu. |
| **Naplno mód** | `?naplno=1` na week/month/day | ✅ NOVÉ 05-04 | Base layout místo Shell. Bez sidebaru, bez Při cestě. Šipky listování zachovávají query string. „Rituální prostor" pro nedělní pohled.|
| **/calendar (sidebar záložka)** | redirect na `/calendar/tyden` | ✅ AKT 05-04 — defaultní desktop pohled je týden. Stará CalendarView se nepoužívá. |
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
| Thanks | `/call-log/thanks` | ✅ public Detekuje VIP **primárně přes `?t=<callLogToken>`** (privátní per-VIP klíč; defense-in-depth — odebrat VIP zruší link), fallback `?phone=` jen pro VIP texty. **Sekce „Giďoušovy mise"** se zobrazí POUZE pro token-ověřené VIP (otevřené nahoře, sbalitelné Hotové za 14 dní; mise zmizí automaticky když Gideon odškrtne v Todoistu). On-demand Todoist sync pokud >5 min. Ne-VIP: „Vzkaz doručen". |
| **VIP token (callLogToken)** | `Contact` model | ✅ NOVÉ 05-02 | 24 znaků base64url, auto-generuje se při `isVip = true`. URL `/call-log?t=<token>` pre-fillne phone z DB a otevře VIP variantu. V `/contacts` u VIP kontaktu sekce „VIP link (privátní)" — copy + regenerate (zruší předchozí). Lib `src/lib/call-log-token.ts`. Endpoint `GET/POST /api/contacts/[id]/call-log-token`. |
| **Todoist obousměrný sync** | cron `todoist-sync` | ✅ ROZŠÍŘENO 05-02 večer | **Plná obousměrná synchronizace**. Z Rašeliniště → Todoist (synchronně): manual create + edit + done + reopen + delete v `/ukoly` propisuje přes `createTask/updateTask/closeTask/reopenTask/deleteTask`. Audio diktát commit auto-pushe všechny tasky (parent+children). Z Todoistu → Rašeliniště (cron 5 min): items sync + projects + labels mirror + **reconcile pass** (klíčové, Sync API completed items nevrací → GET `/tasks/:id` per záznam → 404 = closed, 200 = aktivní → propisuje obousměrně). Audio prompt načítá dynamické tagy (z `Task.tags` + `TodoistLabelMirror`) + kontakty pro AI extrakci. Lib `src/lib/todoist-sync.ts`, `src/lib/task-todoist-push.ts`, `src/lib/todoist.ts`. |
| **VIP isolation (security)** | per `Contact.callLogToken` | ✅ AUDIT 05-02 | Cross-VIP průsak fyzicky nemožný. `callLogToken @unique` 24 znaků base64url (144 bit entropie). `resolveCallLogToken` defense-in-depth `isVip=true` check. `loadVipMissions` strikt `WHERE contactId = X` (žádný phone fallback od `2fb9555`). Fail-closed všude: token expirovaný / VIP odebrán / phone nenalezen → výpis prázdný. Backfill tlačítko v `/contacts` pro existující VIP bez tokenu (před commitem `e4f66d1`). |
| **VIP termín** | submit logika | ✅ UPRAVENO 05-03 ráno | VIP bez termínu teď padá do Todoistu BEZ data (dříve `due_string=today` → Petrovo Today se zaplnilo). `today` zůstává jen pro `urgent` flag. Petr si zařadí kam patří. `src/pages/api/call-log/submit.ts` |
| **Calendar prep AI** | sync-calendars hook | ✅ NOVÉ 05-03 ráno | Petr napíše do Google Calendar / iCloud popisu události „vzít stan, spacák, kameru". AI (Gemini Flash) z popisu vytáhne `CalendarEvent.prepNote` (max 200 zn) + `itemsToBring` (pole stringů). DayView v `/calendar` zobrazí `📝 prepNote` pod eventem. Noční briefing 22:00 agreguje napříč zítřejšími události → ranní Todoist task má sloučený seznam co vzít. Lib `src/lib/calendar-prep-ai.ts`. Hooks v `google-calendar.ts` + `icloud-calendar.ts` fire-and-forget. Idempotence: každý sync re-extrahuje, etag check zachován. |
| Dopisy | `/letters` | ✅ |
| Editor dopisu | `/letters/<id>` nebo `/letters/new` | ✅ |
| Zdraví | `/health` | ✅ AKT 05-03 — 3 dlaždice nahoře: poslední import (rel+abs čas, tint sage<30h/butter<72h/rose), nejnovější měření (`recordedAt`), nových za 24h. |
| Zdravotní analýza | `/health/analyza/<id>` | ✅ NOVÉ 05-03 — full page report (markdown render), tlačítka Stáhnout (.md) / Vytisknout-PDF (window.print) / Zpět. Modal v `HealthAnalyzeModal` po dokončení redirectne sem. Klik na řádek v Uložené analýzy taky sem (ne modal). |
| Health JSON upload | `/settings/ingest` (sekce nahoře) | ✅ NOVÉ 05-03 — bez API tokenu, session auth, `POST /api/health/upload-file` multipart, 50 MB cap. Pro jednorázové roční importy. |
| Capture/Triage | `/capture`, `/triage` | ✅ |
| Poznámky | `/notes` | ✅ |

## 🔧 Diagnostika

| Endpoint | Účel |
|---|---|
| `/api/health/ai` | Test ping na Gemini + mode info |
| `/api/diagnose/studna` | Stav recordings + in-flight + audio na disku + AI errors za 24h + env health + auto-vyhodnocení |

**Když Gideon hlásí problém s audio/Studna**, **první krok**: otevřít `/api/diagnose/studna` v prohlížeči, JSON má pole `conclusions` co řekne kde to vázne.
