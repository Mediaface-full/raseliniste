# 01 — Aktuální stav (2026-04-30)

## Branch + commit

- **main** — produkční větev, vše co se sem pushne se přes GitHub Actions buildí do `ghcr.io`.
- **Aktuální HEAD:** `900caec` (sjednocená /start stránka s úsvitem)

## Co je pushnuto / nepushnuto

Po každé session zkontroluj:
```bash
git log --oneline origin/main..HEAD
git status
```

Pokud `git status` ukáže "Your branch is ahead of 'origin/main' by N commits" → Gideon zatím nepushnul.

**Deploy proces:** Gideon pushuje přes GitHub Desktop → GitHub Actions build (~3 min) → na NASu `~/deploy.sh` (jeden příkaz, viz RUNBOOK.md).

## Posledních 25 commitů (od nejnovějšího)

```
900caec feat(start): sjednocená vstupní stránka /start s dlaždicemi + nová ikona „úsvit"
4d251a3 ux: čitelnost — sans nadpisy + větší /settings sekce + aktivní cog + skrýt zrušené pozvánky
c649dd6 feat(recording): Wake Lock + visibility detekce + JSON repair v ext. úkolů
1838095 ux(sidebar): zjednodušit Nastavení na 1 položku, /settings landing s dlaždicemi
be8363d docs+security: update návodů (5 PDFs, 11 cronů, Ozvěna), rate limit booking, HANDBOOK aktualizace
99d66b2 feat(denik): vyhledávání + měsíční review + Petr→Gideon napříč prompty
00086dd feat(ai-prompts): editovatelné prompty z UI + Gideonův deníkový prompt jako default
c221871 rename: /diktat → /ozvena (Gideon preferred name)
fb07525 feat(denik+diktat): sjednocený /diktat (úkoly+deník přepínač) + nový /denik modul s audio
2f32fac fix(studna): pinning fire-and-forget Promise + diagnostický endpoint (řeší TODO async)
d1a8b38 feat(ai-usage): tracking všech Gemini volání + /settings/ai-usage dashboard
97cbf5b docs: 4 PDF návody — Kalendář, Úkoly, Crony, Testy
9f9e8af feat(ukoly): PWA pro mobil + volba délky 3/10/30 + auto-retry + Lidé/sekce v Todoistu
8b1d94c polish(ukoly): success banner po commit + update PDF cronů na 9 úloh
dbbb098 feat(ukoly): audio diktát úkolů — recorder + AI extrakce + review screen + commit/discard
ed45c73 feat(ukoly): nový Task model + /ukoly UI + delegace + Todoist push (manuální flow)
7f3a969 feat(calendar): fáze 2 — Bookingy (personalizované + univerzální + cold lead)
2f0f680 feat(calendar): polish — Locations admin + OOO management (dovolená/nomád)
cfc8513 feat(studna): inline recorder rovnou v /studna/<projekt> detail
7315370 feat(studna): robustnost — retries + auto-retry stuck recordings + manuální regenerate
7d1cb88 fix(studna): two-stage audio pipeline — vždy získáme přepis (i když analýza selže)
7e7a033 feat(studna): asynchronní zpracování audio — upload OK hned, AI běží na pozadí
1dc1039 fix(studna): velká audia v Vertex módu — fallback na AI Studio Files API
70e9aa6 fix(studna): Vertex AI nepodporuje files.upload() — bezpečný error pro velké audio
dfcdf81 feat(briefing): fáze 3 — noční briefing 22:00 + DayNote + /day UI
```

## Co je nasazeno na produkci?

To záleží na tom, kdy Gideon naposled spustil `~/deploy.sh`. Otázka kterou si u nové session ověř — **zeptat se Gideona „je toto na produkci?"** než předpokládáš.

Diagnostika produkce (Gideon to může spustit za tebe):
```bash
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml ps
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml logs app --tail 50
```

Plus webový diagnostický endpoint: **`/api/diagnose/studna`** (auth: session) — vrátí JSON s in-flight processings, stuck recordings, AI usage errors za 24h, env health.

## Pending DB migrace

Čeká na deploy (proběhnou v entrypoint script `prisma migrate deploy`):
```
prisma/migrations/
├── 20260429122113_add_journal_entries/        ← Deník
├── 20260429162109_add_ai_prompts/             ← AI prompty editor
├── 20260429170518_add_journal_people/         ← Vyhledávání lidí v deníku
└── (vše předchozí už pravděpodobně applied)
```

Migrace jsou idempotentní — re-deploy je bezpečný.

## Aktuální infrastruktura

- **App container:** `raseliniste_app` (image `ghcr.io/duchnotvor/raseliniste/app:latest`, Astro Node standalone, port 3333:3000)
- **DB container:** `raseliniste_db` (postgres:16-alpine, port 5432, named volume `raseliniste_postgres_data_v1`)
- **Reverse proxy:** Synology DSM, port 443 → localhost:3333
- **Cert:** Let's Encrypt automatický
- **Crony:** 11 úloh v DSM Task Scheduler (viz `Návody/03-crony.pdf`)

## Známé „čekající" akce mimo kód

Pokud Gideon zmíní:
- **Nová PWA ikona „Rašeliniště"** na ploše iPhone — má si ji uložit přes Safari → Sdílet → Přidat na plochu z `/start`. Stará ikona „Ozvěna" funguje dál.
- **GCP Budget Alerts** — Gideon si zařídí sám v GCP Console (TODO `todo_gcp_billing.md` v memory).
- **Push commitů z GitHub Desktop** + `~/deploy.sh` na NASu — ruční po každé sadě změn.
