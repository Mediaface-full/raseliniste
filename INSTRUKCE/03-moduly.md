# 03 — Moduly (přehled)

Stav 2026-04-30. Detail jednotlivých modulů v `Návody/*.pdf`.

## 🌅 Vstupní stránka

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Start** | `/start` | ✅ NOVÉ | Sjednocená vstupní stránka pro mobil. PWA ikona „Rašeliniště" (úsvit). 4 dlaždice: Deník, Úkoly, Studna, Zeptat se (brzy). |
| Dashboard | `/` | ✅ | KPI karty, aktivita, sekce „Plán" (nejbližší 3 dny + porušení pravidel). |

## 🎙️ Audio / hlasové zápisy

| Modul | URL | Status | Pozn. |
|---|---|---|---|
| **Ozvěna** (úkoly+deník) | `/ozvena` | ✅ | Sjednocený diktát, přepínač Úkoly/Deník. URL `?mode=task` nebo `?mode=journal` přepne. PWA „Ozvěna" (legacy, stále funkční). |
| Studna nahrávka | `/studna/nahravka` | ✅ | Owner recorder pro Gideona, výběr projektu z dropdownu. |
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
| Hlavní list projektů | `/studna` | ✅ |
| Detail projektu | `/studna/<id>` | ✅ |
| Owner nahrávka | `/studna/nahravka` | ✅ |
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
| Kontakty | `/contacts` | ✅ |
| Firewall historie | `/firewall` | ✅ |
| Veřejné submit | `/call-log` | ✅ public |
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
