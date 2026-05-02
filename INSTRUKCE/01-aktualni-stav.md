# 01 — Aktuální stav (2026-05-02)

## Branch + commit

- **main** — produkční větev
- 3 mega-session deploye:
  - **2026-04-30 večer:** 18 commitů (Studánka rename, Prskavka, RAG, Call-log VIP varianta + animovaná G, vokativ, atd.)
  - **2026-05-01 odpoledne:** 10+ commitů (Výročí, ŽIJEŠ?, Twilio WhatsApp, Web Push, podúkoly z hlasové salvy, OG image fix, fixes)
  - **2026-05-01 večer / 2026-05-02:** 8 commitů (B&W Myš modul plný — fáze A+B+C, smazat tlačítko, edit zarámování, reopen, odložit/víc dat, AI návrh variant, ikona myší v yin-yang)

## B&W Myš modul (2026-05-01 / 02)

Strukturovaný rozhodovací systém. Spec: `~/Downloads/rozhodovaci-system-zadani.md`.

**Hotové (commit 4871704):**
- DB: Decision, DecisionEntry, DecisionEvaluation, DecisionReopening (migrace add_bwmys)
- API: full CRUD + entry text + entry audio + evaluate + reopen + suggest-variants + export
- AI lib `src/lib/bwmys-ai.ts`: 4 prompty (variants, mini, finální 8 sekcí A-H, klasifikace úhlů)
- UI: BwMysList, BwMysNew (6-step), BwMysDetail (hlavička+časová osa+sekce A-H render+4 close mode), BwMysAudioRecorder
- Stránky: /bwmys, /bwmys/nove, /bwmys/[id], /bwmys/archiv (filtry status+kontext, export MD)
- Cron #15 bwmys-tick denně 7:10 (auto-návrat odložených, deadline alert, sběr uplynul, datum revize)
- Sidebar + /start dlaždice (lavender)
- Ikona dvou myší v yin-yang (`bwmys-touch-icon.png` + 192/512)

**Plně dodržené pravidla z PDF spec:**
- Žádný terapeutický tón v AI výstupech
- Pravidlo nevracení (reopen vyžaduje schvaleno=true + popisNovehoFaktu)
- Min 3 varianty / 1 předpoklad / otázka končí ?
- 7 procesních toků (Tok 1-7) všechny implementované

## Co přibylo dnes 2026-05-01

### Velké features
- **Modul Výročí** `/vyroci` (Anniversary model, dashboard banner, „N. výročí svatby" pokud rok zadán, reminder X dní předem)
- **Modul ŽIJEŠ?** `/zijes` (Check-in formulář, archive, mood bar, 2× denně 13:00/18:00 s neutrálním tónem)
- **Twilio WhatsApp integrace** `/settings/whatsapp` (sandbox + production support, lib + cron napojení)
- **Web Push notifikace** `/settings/push` (VAPID + Service Worker, automaticky vypíná WhatsApp jakmile registrován)
- **Hierarchie úkolů** v hlasové salvě (rodič + podúkoly, AI clustering podle TÉMATU, propíše do Todoist parent_id)
- **WhatsApp link preview fix** (Open Graph meta tagy v Base.astro)

### Drobnosti / fixes
- StudnaDetail decision_history podporuje object/string (React error #31 fix)
- Dashboard kalendář — multi-day events ukazují „Probíhá do" místo data v minulosti
- Studánka transcript cleanup (vyloučit ehm/eee/jakože/repetice)
- VIP texty: heading „Zadej Gíďovi jeho misi.", placeholder „Co mu hodíš na hřbet?", animované G + nadpis hvězdičky symetrické

## Posledních commitů (od nejnovějšího — VŠE NA PRODUKCI po dnešním deployi)

```
9372427  docs(todo): aktualizace po 17 commitech dnešní session
d044886  feat(rag): modul "Zeptat se" — pgvector + Gemini RAG
c91f5f6  feat(firewall): zobraz požadovaný termín u VIP vzkazů
e7552a1  copy(thanks): VIP intro 'Děj se vůle Gideonova'
ecc0dae  feat(call-log): VIP texty + thanks 'Zadej další misi'
575ec70  copy(call-log): hint pro dřív Urgent
2f0c723  fix: oddělit ikony Petr/hosté + vokativ + +2 dny + 'Gíďo, máš misi'
221ea51  feat(call-log): VIP varianta jako oddělená entita + termín
8b369ea  feat(studna): dlaždice projektů + zapamatuj poslední
a937839  perf(start): Promise.all + index narozenin
92763f4  feat(start): strom ikona + home button + cron text 7:00
886722c  docs: aktualizace cronu daily-projects-digest 18:00 → 7:00
96979ad  feat(studna): denní digest 7:00 + stránka Aktivita
51aa74c  feat(start): svátek + narozeniny + DASHBOARD + layout nahoru
475865b  docs(todo): staging odloženo
c0ab132  docs: INSTRUKCE/08-deploy-testing.md
b4dd3a4  feat(guest-recorder): hint pro mic permission
2899ed4  fix(security): Permissions-Policy microphone=(self) — Android Chrome blokoval mikrofon
```

## Co se dnes 2026-04-30 nasadilo (VELKÝ DEPLOY)

### 🌳 Ikony rozdělené
- **/start** = strom (zelený, jaro, pozitivní) — `tree-touch-icon.png` + `tree-icon-192/512.png`. Vidí JEN Petr na své úvodní stránce.
- **/call-log a /me/<token>** = G logo (původní fialovo-modrá) — `apple-touch-icon.png` + `icon-192/512.png`. Vidí hosté/klienti.
- Base.astro má prop `appleIconPath` (default G), /start si přepisuje na strom.

### 🔥 Bezpečnostní fix
- **Permissions-Policy** `microphone=()` → `microphone=(self)`. Předtím Android Chrome striktně blokoval mikrofon u klientů (Blanka). iOS Safari to ignoroval, takže se to neprojevilo, dokud nepřišel host na Androidu. Detail v gotcha #18 v `06-troubleshooting.md`.

### 📅 Studna denní digest přesunut na 7:00
- Cron `/api/cron/daily-projects-digest` přesunut z 18:00 na **7:00 ráno**, okno **posledních 24 h** (předtím dnešní den od 00:00).
- 200znakové náhledy z transkriptu, předmět *„Studna — N nových nahrávek (autoři)"*, link na `/studna/aktivita`.
- **AKCE:** Petr musí v DSM Task Scheduler změnit čas z 18:00 na 7:00 (jinak se posílá pořád večer).

### 🌊 Studna stránka Aktivita
- Nová `/studna/aktivita` — posledních 200 záznamů sgrupovaných per den (Dnes / Včera / weekday).
- Tlačítko „Aktivita" v hlavičce `/studna` vedle Nahrávat / Nový projekt.

### 🎯 Studna výběr projektu
- Místo `<select>` 2-sloupcový grid dlaždic.
- LocalStorage `studna-last-project-id` pamatuje poslední výběr.

### 🎂 /start: svátek + narozeniny + DASHBOARD button + layout nahoru
- Nad datem: svátek dne (z `src/lib/jmenny-kalendar.ts`, 366 dnů, zdroj cs.wikipedia).
- Nad datem: 🎂 Jméno má dnes narozeniny (rose tint) + tento týden seznam.
- Pod 4 dlaždicemi: tlačítko **Dashboard** přes celou šířku (klik → /).
- Layout zarovnán nahoru (předtím vertikálně centrovaný — na malých mobilech se muselo scrollovat).

### 🤝 VIP modul (Gideonův Firewall) — oddělená entita
- `/call-log` má teď **dvě varianty**: NONVIP_TEXTS a VIP_TEXTS jako konstanty na začátku souboru. Petr edituje texty na jednom místě.
- **VIP texty (nasazeno):**
  - Title/Apple: *„Gíďo, máš misi"*
  - Heading: *„Zadej Gíďovi, máš misi."*
  - Intro: *„Pošli mu to a trochu mu rozčeř svět."*
  - Submit: *„Vypusť Gíďu"*
  - Hint pod datumem: *„Termín nejdřív za 2 dny. Pokud to potřebuješ dřív, zaškrtni níže Urgent."*
- **VIP datum splnění** (volitelné, type=date), min = +2 dny dopředu, max = +2 roky.
- Datum se propíše do **Todoist `due_date` YYYY-MM-DD** + do popisu *„📅 Termín požadovaný od VIP: ..."*.
- Datum je **VIP-only privilegium** — server ignoruje pole pokud volající nemá v DB `isVip=true`.
- DB: `CallLog.requestedDueAt DateTime?` (migrace 20260430181432).

### 🎤 Vokativ pro VIP oslovení
- *„Ahoj, Karle"* místo *„Ahoj, Karel"*.
- Hybrid řešení:
  - DB pole `Contact.firstNameVocative String?` (manuální override pro výjimky)
  - `src/lib/vokativ.ts` — tabulka 40+ výjimek + algoritmus pro běžné koncovky
  - V `/kontakty` editoru kontaktu nové pole *„Oslovení (5. pád) — jen VIP"* s placeholderem
- Migrace 20260430182556_add_contact_first_name_vocative.

### 📩 Thanks stránka pro VIP
- `/call-log/thanks?phone=X` detekuje VIP.
- VIP vidí **„Mise vypuštěna ✦"** + *„Gíďa už ví. Děj se vůle Gideonova. Mezitím — kdyby tě napadlo něco dalšího, klidně mu pošli další misi."*
- Tlačítko **„Zadej další misi"** vede zpět na `/call-log?phone=X&name=Y` (zachová kontext).
- Ne-VIP zůstává jak byla.

### 🛡 Firewall admin
- V `/firewall` u VIP vzkazu s vyplněným termínem teď svítí rose badge: **📅 do 15. 5. 2026** vedle VIP/Urgent štítků.

### 🤖 RAG modul „Zeptat se" — NOVÉ (commit d044886)
- **Routa:** `/zeptat-se` (Astro stránka + AskWidget React island)
- **Aktivováno** na /start dlaždici (lavender, předtím „brzy")
- **DB:** pgvector extension + tabulka `RagChunk` (sourceType, sourceId, chunkIdx, text, embedding vector(768))
- **Embedding:** Gemini text-embedding-004, 768 dim, asymetrický taskType (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY)
- **Search:** cosine similarity přes pgvector `<=>` operator (raw SQL, top 8)
- **LLM:** Gemini 2.5 Pro generuje odpověď s [N] citacemi
- **Auto-indexace:** nové JournalEntry / Task / ProjectRecording (po `processed`) jdou automaticky do indexu (fire-and-forget s module-level Set pinningu, jako process-recording.ts)
- **Chunking:** 600 znaků s 100 znaky overlapem, dělí se na hranicích vět/slov
- **Backfill:** ZÁMĚRNĚ NEPROVEDEN — Gideon explicitně řekl „jen od teď"
- **Náklady:** ~80 Kč/měs při 5 dotazech denně
- **Lib:** `src/lib/rag.ts` (chunkText, embedText, embedQuery, indexEntity, unindexEntity, searchChunks, answerQuestion)
- **Postgres image:** docker-compose změněn na `pgvector/pgvector:pg16` (drop-in superset). **AKCE byla provedena:** `docker compose pull postgres && docker compose up -d --force-recreate postgres`. Pgvector 0.8.2 ověřen.

## Aktuální infrastruktura (po dnešním deployi)

- **App container:** `raseliniste_app` (image `ghcr.io/duchnotvor/raseliniste/app:latest`, Astro Node standalone, port 3333:3000)
- **DB container:** `raseliniste_db` (`pgvector/pgvector:pg16`, pgvector 0.8.2, port 5432, named volume zachován)
- **Reverse proxy:** Synology DSM, port 443 → localhost:3333
- **Cert:** Let's Encrypt automatický
- **Crony:** 11 úloh v DSM Task Scheduler (`daily-projects-digest` vyžaduje **manuální posun na 7:00**)

## Známé „čekající" akce mimo kód

- **DSM Task Scheduler — daily-projects-digest přesun z 18:00 na 7:00.** Petr musí udělat ručně v DSM (Control Panel → Task Scheduler → najít úlohu → změnit hodinu).
- **GCP Budget Alerts** — Gideon si zařídí sám v GCP Console (TODO `todo_gcp_billing.md` v memory).
- **Test RAG na produkci:** vytvořit pár deníkových zápisů + položit dotaz na `/zeptat-se`.
- **Test VIP flow:** poslat si link sám sobě z `/kontakty` (klik na 🔗 vedle VIP kontaktu) + ověřit že vokativ + datum picker funguje.

## Diagnostika produkce

```bash
# 1. Stav kontejnerů
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml ps

# 2. App log
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml logs app --tail 50

# 3. RAG specifické
sudo docker exec raseliniste_db psql -U raseliniste -d raseliniste -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
sudo docker exec raseliniste_db psql -U raseliniste -d raseliniste -c "SELECT \"sourceType\", COUNT(*) FROM \"RagChunk\" GROUP BY \"sourceType\";"
```

Plus webový endpoint: **`/api/diagnose/studna`** (auth: session).
