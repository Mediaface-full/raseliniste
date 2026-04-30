# 04 — TODO list (2026-04-30)

## 🟧 Aktivní (čeká na zpracování)

### Na produkci jako další (po push 900caec)

1. **Push aktuálních commitů** + `~/deploy.sh` — Gideon zatím nepushnul.
2. **Otestovat /start** na mobilu — uložit PWA ikonu „Rašeliniště" (úsvit) na plochu.
3. **GCP Budget Alert** — Gideon si zařídí v GCP Console (1 minuta, žádný kód). Detail v memory `todo_gcp_billing.md`.

### Ve frontě k implementaci (Gideon je pojmenoval, čeká na další session)

4. **„Zeptat se" dlaždice na /start** — AI dotaz nad deníky + úkoly přes pgvector embeddings.
   - Nová DB extension `vector` v Postgresu
   - Sloupec `JournalEntry.embedding vector(768)` + `Task.embedding vector(768)`
   - Embedding při uložení přes Gemini `text-embedding-004`
   - Backfill script pro existující záznamy
   - Search endpoint: cosine similarity → top 10 → Gemini Pro odpověď
   - UI: textarea + mikrofon + odpověď s citacemi
   - Cost: ~80 Kč/měs při 5 dotazech denně

5. **GCP Cloud Billing API integrace** (volitelné, jen pokud Budget Alerts nestačí)
   - Reálné fakturační údaje z GCP vedle našeho odhadu v `/settings/ai-usage`
   - Service account permission `roles/billing.viewer`
   - Lag 24h (GCP fakturuje s denním zpožděním)
   - Detail v memory `todo_gcp_billing.md` (varianta B)

6. **Staging prostředí + smoke test + rollback** (odloženo — teď není čas/prostor)
   - Cíl: nikdy nenasadit rozbitou verzi produkčním uživatelům (Blanka & spol.)
   - Plný návod už je sepsaný v `INSTRUKCE/08-deploy-testing.md`
   - K udělání:
     - `docker-compose.staging.yml` (druhý stack na NASu, port 3334, vlastní DB)
     - DSM Reverse Proxy: `staging.raseliniste.cz` → `localhost:3334`
     - `scripts/smoke.sh` — bash skript co projede klíčové stránky a hlavičky
     - Rollback procedura: tag `:rollback` před každým deployem
   - Resource: ~400 MB RAM + ~1 GB disk na NASu (DS718+ to zvládne)
   - Alternativa pro zatím: lokální dev na Macu před push + smoke test po deployi na prod (90 % ochrany za 0 % NAS resources)
   - Aktivovat až bude víc uživatelů / víc změn najednou

## ✅ Hotové (recent commits, čeká na push/deploy)

Top 10 commitů od posledního stable bodu, viz `01-aktualni-stav.md` pro plný seznam.

- `900caec` — /start sjednocená vstupní stránka + nová ikona „úsvit"
- `4d251a3` — Sans nadpisy default + větší /settings sekce + aktivní cog + skrýt CANCELED
- `c649dd6` — Wake Lock + visibility + JSON repair (4 recordery)
- `1838095` — Settings landing s dlaždicemi (sidebar zmenšen na 1 položku)
- `00086dd` — Editovatelné AI prompty
- `2f32fac` — Studna fire-and-forget Promise pinning (vyřešený TODO)

## 🟡 Nice-to-have (long-term backlog)

V memory nebo v dřívějších návrzích, ne urgentní:

- **Per-projekt ikona Studny** (vlastní logo + dynamický apple-touch-icon per host link)
- **Automatický backup DB** (nightly pg_dump → druhý NAS / Backblaze B2)
- **Push notifikace** pro VIP firewall vzkazy (Web Push nebo Telegram bot)
- **Editovat ostatní prompty v /settings/ai-prompts** (capture-classifier, journal-redact, letter-redact, event-classifier, event-parser, health-analyze) — momentálně hardcoded
- **AI chat s RAG** napříč všemi daty (Recordings + Entries + Health + Studna) — širší scope než „Zeptat se"
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
- `todo_studna_async_still_failing.md` — VYŘEŠENO commit 2f32fac (zachováno pro audit)
- `todo_gcp_billing.md` — GCP Billing 3 vrstvy

## 📋 Pravidlo pro práci s TODO

1. **Nepřidávej** vlastní položky bez Gideonova zadání.
2. **Aktualizuj** tento soubor po každé větší sadě commitů.
3. **Když Gideon zmíní novou věc** která nepatří k aktuální práci, přidej ji buď sem nebo do memory (přes Write tool do `/Users/petrperina/.claude/projects/.../memory/todo_xxx.md`) + odkaz v MEMORY.md.
4. **Před koncem session** zhrň co jsi udělala, na čem pracuješ, a co je další krok. Ulož významné změny do `01-aktualni-stav.md`.
