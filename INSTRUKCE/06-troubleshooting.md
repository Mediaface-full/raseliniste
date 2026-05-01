# 06 — Troubleshooting + známé pasti

## První akce když Gideon hlásí problém

```bash
# 1. Diagnostický endpoint (přes prohlížeč, auth=session)
https://www.raseliniste.cz/api/diagnose/studna

# Vrátí JSON s:
# - In-flight processings v paměti Node procesu
# - Last 20 ProjectRecording + TaskAudioBatch + JournalEntry stavů
# - AI usage errors za 24h
# - Env health flags (geminiMode, vertexProject, geminiApiKey present)
# - Auto-vyhodnocení do `conclusions[]` s emoji (🔴 fatal / 🟡 warn / ⚠ konfig)
```

**Pokud `conclusions` říká kde to vázne, řiď se tím.**

## Logy aplikace na NASu

```bash
sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml logs app --tail 100

# Hledej:
# - [process-recording] / [process-task-audio] / [process-journal-audio]
# - [audio-transcribe] retry / fallback
# - [task-extract] truncated JSON opraven
# - "Error", "EACCES", "ENOENT", "Failed"
```

## DB stav

```bash
sudo docker exec raseliniste_db psql -U raseliniste -d raseliniste \
  -c "SELECT id, status, processingError FROM \"ProjectRecording\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

## Známé pasti — RUNBOOK §8 + naše doplnění

### 1. Empty string z `${VAR:-}` v compose
- **Symptom:** login po deployi 500
- **Fix:** `lib/env.ts` má `emptyToUndef()` helper. Při přidávání nové env proměnné vždy obal.
- Dříve řešený commit, teď systémové.

### 2. `docker compose restart` nečte .env
- Vždy `docker compose up -d --force-recreate` nebo `~/deploy.sh`.

### 3. Synology nemá `nano` — jen `vi`
- `vi <file>`, insert `i`, save+exit `Esc :wq`

### 4. Heredoc paste do souboru = catastrophe
- Heredoc patří do shellu, ne do souboru přes vi.

### 5. `gcp-key.json` chmod 644 (ne 600)
- Kontejner běží jako neroot. 600 = EACCES.

### 6. Vertex audio > 14 MB
- Vertex AI nepodporuje `genai.files.upload()` — jen AI Studio Files API.
- Fallback na `GEMINI_API_KEY` automatický (commit 1dc1039).
- Pokud chybí klíč v env, jasný error.

### 7. Astro nezahrnuje `src/assets/*` do `dist/server/`
- Statické soubory dej do `public/`.

### 8. DSM Reverse Proxy občas zmizí po DSM update
- Když Gideon vidí Webstation default → DSM Control Panel → Login Portal → Reverse Proxy → ověř `www.raseliniste.cz` → `localhost:3333`.

### 9. Login attempt rate-limit
- 5 failů / 15 min per username. Když Gideon nemůže se přihlásit, často to není heslo, ale lock. Smaž LoginAttempt přes psql.

### 10. Astro `checkOrigin: false` v config
- Vypnuto kvůli reverse proxy mismatch (Astro vidí localhost, browser posílá raseliniste.cz). Kompenzováno sameSite=lax cookies + ostatní vrstvy. **Neřazet zpět**.

### 11. `cleanup-audio` cron mažou STANDARD audio po 14 dnech
- Pokud Gideon nutně potřebuje starší → `audioRetainForever=true` toggle v UI.

### 12. **Fire-and-forget Promise GC v Astro/Node**
- **CRITICAL pattern:** všechny audio processing funkce (`process-recording.ts`, `process-task-audio.ts`, `process-journal-audio.ts`) MAJÍ module-level `Set<InFlight>` co drží Promise reference. Bez něj Node garbage-collectoval Promise → recording trčel ve „processing" navždy.
- **NIKDY** nepřepisuj na čisté `void fnAsync(...)` bez Set pinningu.
- Detail: viz commit 2f32fac.

### 13. Vertex JSON output mode pro audio je nespolehlivý
- Občas chybí pole `transcript` ve výstupu. **Two-stage pipeline** to obchází: Stage 1 plain-text přepis → Stage 2 JSON nad přepisem (žádné audio v requestu).
- Detail: commit 7d1cb88.

### 14. Truncated JSON v extrakci úkolů
- Petrovy salvy 10+ úkolů překračovaly max 4000 tokens.
- Fix: `maxOutputTokens: 12_000` + `repairTruncatedTasksJson()` helper co zachrání aspoň prvních N úkolů ze cut-off response.
- Detail: commit c649dd6.

### 15. iOS Safari suspenduje JS při zamčení / přepnutí
- MediaRecorder se zastaví → audio se ztrácí.
- **Wake Lock API** zabrání AUTOMATICKÉMU uzamčení (ne manuálnímu power buttonu).
- **Visibility change tracking** detekuje přepnutí, audio sanity check po Stop.
- Hook: `src/components/useRecordingProtection.ts`. Aplikováno na všechny 4 recordery.
- Pro dlouhé záznamy doporučení: iOS Voice Memos → upload přes „Nahrát soubor".

### 16. Prisma 7 `seed.ts` nefunguje v produkčním kontejneru
- Importuje z `src/lib/*` co není v dist. Workaround: SQL INSERT.
- Pro single-user není problém.

### 17. heal-migrations.mjs Prisma 7 import error
- `import { PrismaClient } from "@prisma/client"` nefunguje v Prisma 7 (CommonJS).
- Heal step skipped, ale `prisma migrate deploy` proběhne OK. Známý bug.

### 19. Web Push na iOS funguje JEN přes PWA na ploše
- iOS 16.4+ povoluje `Notification` API + Push pouze pro stránky přidané jako PWA na home screen
- V Safari (bez PWA) `'Notification' in window` vrátí false / permission denied
- **Návod pro Petra:** Safari → Sdílet → Přidat na plochu → otevřít Z PLOCHY (ne ze Safari) → /settings/push → Povolit
- **Widgety NE:** Safari widget / smart stack otevírá v Safari, ne v PWA → push tam neprojde
- Android Chrome funguje bez PWA

### 20. WhatsApp link preview cache
- Když pošleš odkaz `/me/<token>` přes WhatsApp/Meta, WhatsApp si stáhne preview a cachuje na **týdny per URL**
- Změna obsahu (rename Studna→Studánka, nová ikona) **neaktualizuje cache** automaticky
- Řešení A: pošli link s `?v=2` (nebo libovolný query) — WhatsApp ho vezme jako jiný URL
- Řešení B: Facebook Sharing Debugger https://developers.facebook.com/tools/debug/ → Scrape Again
- Open Graph meta tagy v `Base.astro` (og:image plně absolutní) zajistí správný preview pro **nové** linky

### 21. CRON_SECRET pro DSM Task Scheduler
- Není v `.env`? Zkontroluj `docker compose exec raseliniste_app env | grep CRON_SECRET`
- Pokud není ani v kontejneru, žádné crony nefungují (vrací 503)
- Vygeneruj: `echo "CRON_SECRET=$(openssl rand -base64 32)" >> .env && sudo docker compose up -d --force-recreate app`
- Pak ten samý řetězec do **každé** DSM Task úlohy v `-H "x-cron-key: ..."`
- **Neposílej hodnotu nikam mimo .env** — citlivé jako heslo

### 22. React error #31 v komponentě (objects as React child)
- Symptom: stránka /studna/<id> prázdná po hydrataci, infinite loading
- Console: `Minified React error #31; ... object with keys {decision, rationale, timestamp}`
- Příčina: AI Stage 2 vrátila pole objektů místo stringů, render typuje `string`
- Fix: typeof check + render obou variant (viz commit 0624d7c StudnaDetail decision_history)
- Hledat ostatní podobné rendry kde JSX typuje primitivně z `analysis.*` — případně dát defenzivní `typeof === "object"` branch

### 18. Permissions-Policy `microphone=()` blokuje mikrofon na Androidu
- **Symptom:** klient na Androidu (Blanka) otevře `/me/<token>`, stránka se načte, ale tap na mikrofon nereaguje. Na iPhonu funguje normálně.
- **Příčina:** W3C Permissions-Policy: `microphone=()` = empty allowlist = **blokováno všem včetně same-origin**. iOS Safari to historicky ignoroval (lenient impl), Android Chrome dodržuje striktně.
- **Fix:** v `src/middleware.ts` musí být `microphone=(self)` (povolení pro vlastní origin) — `()` blokuje totálně.
- **Jak se to stalo:** původní scaffold měl `microphone=()` z paranoie, Petr testoval jen na iPhonu → bug ležel od commitu 8f1bdfa, projevil se až při guestech na Androidu.
- **Pravidlo:** `()` použij JEN na features které opravdu nikdy nechceš (camera, geolocation). Pro mikrofon (Studna, Ozvěna, /me/) musí být `(self)`.

## Co dělat když se nějak ztratíš

1. Otevři `INSTRUKCE/00-START-HERE.md` znovu
2. `git log --oneline -20` + `git status`
3. Zeptej se Gideona „Jsem v půli něčeho, jaký je stav?"
4. **Nesnažíš se opravovat aktivní rozpracovanou session** — dokud Gideon nepotvrdí

## Diagnostika prohlížeče (ne kódu)

Když Gideon hlásí UI problém:
1. **Hard refresh** (Cmd+Shift+R) — kvůli CSS/JS cache
2. **Anonym okno** — ověřit jestli to není local cache / cookie problém
3. **Konzole prohlížeče** (Cmd+Opt+I) — error stack trace
4. **Network tab** — failed XHR, status code
