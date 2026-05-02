# 04 — TODO list (2026-04-30 večer)

## 🟧 Aktivní (čeká na zpracování)

### Manuální akce v DSM (jen Petr) — ZÁSADNÍ ZMĚNA 2026-05-02

**Cron scheduler architektura: 1 DSM entry místo 16.** Pokud máš starý cron seznam, smaž všechny úlohy s prefixem `Raseliniste …` a vytvoř jednu novou úlohu:

1. **DSM Task Scheduler:** vytvořit JEDINÝ entry `Raseliniste cron scheduler`
   - User-defined script jako root, command:
     ```
     curl -fsS -X POST -H "x-cron-key: $CRON_SECRET" https://www.raseliniste.cz/api/cron/scheduler --max-time 120
     ```
   - Schedule: Daily, First run 00:00, Frequency Every 5 minutes, Last run 23:55
   - Tahle jediná úloha pak interně spouští 16 dříve oddělených cronů dle rozvrhu v kódu (`src/lib/cron-schedule.ts`)
   - Stav vidíš na Dashboard / `/start` / `/settings/crons`

2. **Smazat staré úlohy** (16 řádků s prefix `Raseliniste …`) — už nejsou potřeba, dispatcher je volá interně. **Kontrola:** v DSM zůstane jen ten jeden `Raseliniste cron scheduler` entry.

3. **První tick:** po vytvoření klikni Run → response by měl být JSON s `jobsMatched` &gt; 0 (záleží na čase) a `dryRun: false`. Zkontroluj `/settings/crons` že úlohy mají `lastSuccessAt`.

4. **První Todoist sync = full snapshot** — naimportuje všechny aktivní úkoly z Todoistu (i ty co Petr přidal mimo aplikaci) do `Task` se `source=todoist_pull`.

### GCP Budget Alert (volitelné)
2. **GCP Budget Alert** — Gideon si zařídí v GCP Console (1 minuta, žádný kód). Detail v memory `todo_gcp_billing.md`.

### Test produkce
3. **Test RAG po prvním zápisu:**
   - Vytvořit deníkový zápis na `/denik`
   - Otevřít `/zeptat-se` — statistika by měla skočit na „📓 deníky 1+"
   - Položit dotaz — měl by vrátit odpověď s [1] citací
4. **Test VIP flow:**
   - V `/kontakty` označit testovacího kontaktu jako VIP + vyplnit telefon (svůj)
   - Klik na 🔗 vedle kontaktu = link do clipboardu
   - Otevřít v anonymu — měl bys vidět „Gíďo, máš misi", datum picker, „Vypusť Gíďu"
   - Po odeslání: „Mise vypuštěna ✦" + tlačítko „Zadej další misi"

### Volitelné větší úlohy
7. **GCP Cloud Billing API integrace** (jen pokud Budget Alerts nestačí)
   - Reálné fakturační údaje vedle našeho odhadu v `/settings/ai-usage`
   - `roles/billing.viewer` service account permission, lag 24 h
   - Detail v memory `todo_gcp_billing.md` (varianta B)

8. **Staging prostředí + smoke test + rollback** (odloženo)
   - Plný návod už je v `INSTRUKCE/08-deploy-testing.md`
   - Resource: ~400 MB RAM + ~1 GB disk na NASu
   - Aktivovat až bude víc uživatelů / víc změn najednou

## ✅ Hotové dnes (1 session, 17 commitů)

```
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
886722c  docs: aktualizace cronu 18:00 → 7:00
96979ad  feat(studna): denní digest 7:00 + stránka Aktivita
51aa74c  feat(start): svátek + narozeniny + DASHBOARD + layout nahoru
475865b  docs(todo): staging odloženo do TODO
c0ab132  docs: INSTRUKCE/08-deploy-testing.md
b4dd3a4  feat(guest-recorder): hint pro mic permission
2899ed4  fix(security): Permissions-Policy microphone=(self)
```

## 🟡 Nice-to-have (long-term backlog)

V memory nebo v dřívějších návrzích, ne urgentní:

- **Backfill RAG indexu** pro existující data (Petr aktuálně nechce, jen nové od deployu)
- **Reindex tlačítko** v admin (až bude potřeba)
- **Cleanup orphan RagChunks** cronem (smazaný zdroj → vyřadit chunky)
- **Mikrofon na /zeptat-se** (Wake Lock + transkripce, hlasový dotaz)
- **Per-projekt ikona Studny** (vlastní logo + dynamický apple-touch-icon per host link)
- **Automatický backup DB** (nightly pg_dump → druhý NAS / Backblaze B2)
- **Push notifikace** pro VIP firewall vzkazy (Web Push nebo Telegram bot)
- **Editovat ostatní prompty v /settings/ai-prompts** (capture-classifier, journal-redact, letter-redact, event-classifier, event-parser, health-analyze) — momentálně hardcoded
- **Health detail per metrika** (klikneš na KPI → samostatná detailní analýza)
- **Recurring úkoly** (nebo nechat na Todoistu)
- **Capture iPhone Shortcut** — JSON body připravený, dořešit reference shortcut
- **Tasks pull-sync z Todoistu** (odškrtnutí v Todoistu se propíše do `/ukoly`)
- **WebAuthn enrollment dalších zařízení** (UI v `/settings/security`)

## ❌ Záměrně vyřazeno

- Plaud / Superlist / Claude kouč integrace — Gideon o nich mluvil dřív, ale nezadal ke spuštění
- Multi-user (single-user je hard requirement, schémata už multi-user-ready, infrastruktura ne)
- Žádné notifikace na hodinky / Apple Watch
- Žádné voice commit přes Siri (Siri shortcut umí jen check, ne commit — vědomá pojistka proti misparsům)
- Žádný cross-write iCloud → Google nebo opačně
- Žádné AI návrhy slotů / auto-rescheduling (Gideon chce kontrolu)

## 🔍 Memory TODO files (per-projekt, persistuje napříč sessions)

`/Users/petrperina/.claude/projects/.../memory/`:
- `MEMORY.md` — index všech persistent records
- `user_profile.md` — Gideon profile
- `design_preferences.md` — design history (4 zamítnuté pokusy)
- `todo_studna_async_still_failing.md` — VYŘEŠENO commit 2f32fac
- `todo_gcp_billing.md` — GCP Billing 3 vrstvy

## 📋 Pravidlo pro práci s TODO

1. **Nepřidávej** vlastní položky bez Gideonova zadání.
2. **Aktualizuj** tento soubor po každé větší sadě commitů.
3. **Když Gideon zmíní novou věc** která nepatří k aktuální práci, přidej ji buď sem nebo do memory.
4. **Před koncem session** zhrň co jsi udělala, na čem pracuješ, a co je další krok. Ulož významné změny do `01-aktualni-stav.md`.
