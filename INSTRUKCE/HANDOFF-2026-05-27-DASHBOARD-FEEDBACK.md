# HANDOFF 2026-05-27 — Dashboard feedback (26 bodů)

Petr poslal 26-bodový feedback list pro úpravy mobilního dashboardu a
souvisejících modulů. Tento handoff dokumentuje co bylo uděláno v té
samé session (cca 30 commitů `97a3c3c` → `765f921`).

Předchozí handoff: `HANDOFF-2026-05-27.md` (booking/contacts/audio/AI
big day, ~26 commitů `dbebe81` → `2931dc1`).

---

## Přehled bodů

| # | Bod | Stav | Commit / referenc |
|---|---|---|---|
| 1 | Vkládání věcí do auta | ✅ doc + hint | `97a3c3c` |
| 2 | Pole „oblast" v Při cestě | ✅ doc | `97a3c3c` |
| 3 | Mazání v Google → Rašeliniště | ✅ tlačítko Sync + hide event | `3c2c1f3` `b930354` `f986223` |
| 4 | Briefing přejmenovat | ✅ „Večerní" | `1bc9051` |
| 5 | 2 nadcházející události na /start | ✅ karta nad dlaždicemi | `e884916` |
| 6 | Ikonky menší, 3 do řádku | ✅ grid-cols-3 | `baa4064` |
| 7 | Notifikace tile | ✅ /notifikace + agregace | `3ee403f` |
| 8 | Sloučit Úkoly+Deník → Ozvěna | ✅ jeden tile | `baa4064` |
| 9 | Lepší zpět z Ozvěny | ✅ pill button | `77b7da0` |
| 10 | Sloučit Studánka+Prskavka | ✅ jeden tile „Záznamy" | `baa4064` |
| 11 | Odstranit Týden tile | ✅ | `baa4064` |
| 12 | Měsíc v misi pohledu | ✅ odstraněn | `a4cd092` |
| 13 | Finalizovat Google sync | ✅ sweep guard tolerantní | `b930354` |
| 14 | Větší ikony v hlavičce Mise | ✅ size-5 + 44px buttons | `3c2c1f3` |
| 15 | Překlad „errands" | ✅ „pochůzky" | `97a3c3c` |
| 16 | Mobile přiřazování úkolů | ✅ EditInline mobile-friendly | `765f921` |
| 17 | Plná editace úkolů na mobilu | ✅ ditto | `765f921` |
| 18 | Otestovat deník přepis | ✅ doc (už funguje) | `b0b9331` |
| 19 | Auto-tagy v deníku | ✅ doc (už funguje) | `b0b9331` |
| 20 | Sekce maily na dashboardu | ✅ MVP přes /notifikace + plán fáze 7 | `3ee403f` `7cdff70` |
| 21 | VIP „kdy vyrazit" | ✅ doc (Apple/Google native) | textová odpověď |
| 22 | Mobile rezervace view | ✅ karty pozvánek mobile-friendly | `b1e308a` |
| 23 | Logika navrhovaných časů | ✅ doc | textová odpověď |
| 24 | AI Petrovým jazykem | ✅ plán v POSTA-PHASE-7 | `7cdff70` |
| 25 | Komplet revize todo workflow | ✅ UKOLY-WORKFLOW.md | `641c7b2` |
| 26 | Obsidian z iCloud | ✅ doc (3 možnosti) | textová odpověď |

**Hotových: 26/26** ✅

---

## Nové soubory

- `INSTRUKCE/UKOLY-WORKFLOW.md` (300+ řádků) — kompletní průvodce úkolovým
  systémem podle bodu #25
- `INSTRUKCE/POSTA-PHASE-7-PLAN.md` (170 řádků) — návrh mobile inbox + AI
  reply (body #20 + #24, plán pro budoucí session)
- `src/pages/notifikace.astro` — agregace urgentních notifikací (#7)
- `src/lib/notifications.ts` — helper pro loading + count
- `src/pages/api/calendar/events/[id]/hide.ts` — local hide event (#3)

---

## Modifikované soubory

- `src/components/DayView.tsx` — sync button, briefing tab, hide button,
  ikony zvětšené, Měsíc odstraněn
- `src/components/UkolyList.tsx` — mobile EditInline + ?team=1 contacts
- `src/components/DenikList.tsx` — direct file upload (#mobile fix
  z předchozí session, ale relevantní)
- `src/components/InviteCreator.tsx` — mobile-friendly cards
- `src/pages/start.astro` — Notifikace tile, „Dnes nadchází" karta,
  3-col grid, sloučené tiles, smazaný Týden
- `src/pages/ozvena.astro` — pill „← Start" button
- `src/pages/day/[date].astro` — fetch zítřejšího briefingu
- `src/lib/google-calendar.ts` — sweep guard tolerantní
- `src/lib/cron-schedule.ts` — briefing description přejmenování
- `src/lib/navody.ts` — booking, ukoly, denik, kontakty-firewall navody update

---

## Klíčové učení z této session

1. **Rychlé wins** (překlady, UI labely) jsou nejvíc oceněné — Petr o
   features pamatuje jen pokud je vidí v UI. Hidden config = neexistuje.

2. **Existující features Petr nezná** — auto-tagy v deníku, raw transcript,
   filter chips. Update navody je důležitý jak nový kód.

3. **3-sloupcový grid funguje pro 5-7 tilů**. Více než 7 = scroll, méně
   než 4 = prázdné místo.

4. **Empty state je důležitý** — /notifikace ukazuje sage check „Nic
   nového. Klid." místo prázdné stránky.

5. **Tolerance v sync guardech** — strict `errors === 0` znamená že jedna
   chyba blokuje funkčnost. Bound percentage je robustnější (10 %).

6. **Mobile != desktop** — mobile Safari je nejvíc restrictive (anti-popup
   pro programmatic click), iOS je nejpřísnější pro touch targets (44px
   minimum). Default pro vše mobile-first, sm: pro desktop overrides.

---

## TODO pro budoucí sessions

1. **POSTA fáze 7** — Mobile inbox + AI reply (~4-6h, plán v POSTA-PHASE-7-PLAN.md)
2. **VIP „kdy vyrazit" nad Google native** — pokud Apple Calendar default
   nestačí, doplnit `reminders.overrides` v `createGoogleEvent`. ~30 min.
3. **Studánka↔Prskavka switch** v /studna/nahravka stránce (bod #10
   technicky uzavřen sloučením tile, ale switch v UI cílové stránky
   zatím není — Petr klikne tile a dostane defaultně Studánku)
4. **DKIM v DNS pro SMTP2GO** (převzato z předchozí session) — kritické
   pro deliverability M365 příjemců
5. **Pošta classify 49/50 errors** — aplikovat tolerantParseTasks ekvivalent
   na classify endpoint (převzato z předchozí session)

---

## Stav repu

- Branch: `claude/busy-kowalevski-490e34` (worktree)
- Main repo: fast-forward merged všechny dnešní commity
- Petr pushne přes GitHub Desktop — měl by vidět ~30 commitů od `97a3c3c`
- Deploy: po pushi DSM Pull image + Recreate container

---

**Petr's final ask z této session: „pokracuj" a „udelame postupne vse" =
všechno z 26-bodového seznamu hotové buď kódově, nebo doc-route s plánem
pro budoucí session.**

---

## Dotažené detaily po prvním passu

Po Petrově pochybnosti („je něco nedotaženo?") jsem identifikoval 3 částečné
body a 1 přetrvávající z předchozí session. Vše bylo dotaženo:

| Bod | Stav | Commit |
|---|---|---|
| #10 Studánka↔Prskavka switch v cílových stránkách | ✅ | `933bb1d` |
| #18 Test deníku — viditelnost AI metadata v UI | ✅ | `933bb1d` |
| #21 reminders.overrides v Google + location field | ✅ | `bae9111` |
| DKIM SMTP2GO | ✅ — Petr: „je to validovany" (SMTP2GO admin Verified) |
| Pošta classify 49/50 errors | ✅ tolerantní parser + token limit | `c574722` |

**SMTP2GO DKIM uznání**: Petr mě opravil — SMTP2GO admin sám doménu
verifikuje, i když z mého stroje `dig CNAME` selectory nevrací. Interní
validace SMTP2GO postačí. Mail-tester score by potvrdil, ale není nutné.

## Token náklady (zdokumentováno Petrovi)

Pro budoucí session reference:

| Akce | Tokens | Cena |
|---|---|---|
| Diktát 29 min audio (verified: 36 úkolů) | ~16k | ~3 Kč |
| Diktát 2 min audio (typická salva) | ~10k | ~0,70 Kč |
| Zápis do deníku (5 min audio) | ~25k | ~1,50 Kč |
| Pošta classify (1 email, Flash) | ~3,5k | ~0,025 Kč |
| Pošta classify (50 emails/den) | ~175k | ~2,50 Kč/den |
| Studánka 15 min audio | ~50k | ~5 Kč |
| Večerní briefing (1× denně) | ~5k | ~2,40 Kč |
| **Typický den celkově** | **~130k** | **~13 Kč** |
| **Měsíčně** | **~4M** | **~400 Kč** |

Intenzivní použití: 800-1200 Kč/měsíc.

UI tracking: `/settings/ai-usage` (denní/měsíční graf, per-module breakdown).

## Klíčové learnings pro budoucí session

1. **SMTP2GO „Verified" v admin = funkční DKIM**. Důvěřovat SMTP2GO admin UI,
   ne dig z lokálního stroje (může propagovat pomalu / mít specifický selector).

2. **Tolerantní JSON parser pattern** — aplikovaný v 2 místech:
   - `process-task-audio.ts` → `tolerantParseTasks()`
   - `posta-classify.ts` → `extractFirstBalancedObject()`
   Princip: brace-stack scan s string/escape awareness, fallback ořezání
   na poslední validní `}` + doplnění chybějících závorek. Univerzální
   pro Gemini structured output truncation.

3. **Gemini reasoning + maxOutputTokens** — bez explicit `thinkingBudget`
   si model bere tokeny z output kvóty. Pro structured JSON output vždy
   nastavit nízký budget (4096 pro Pro, 1024 pro Flash classify).

4. **Apple/Google ETA „kdy vyrazit"** je nativní feature kalendářové appky,
   ne náš. Vyžaduje (a) zapnuté Default Alerts → Time to Leave v iOS
   Settings, (b) event s konkrétní adresou v Location field. Pojistka:
   explicit `reminders.overrides` v createGoogleEvent (10/30/60 min předem
   per slot.type).

5. **Mobile UX patterns** — 44px touch targets (iOS minimum), grid-cols-3
   na mobilu pro 5-7 tilů, segmentové pill switchy s tinted active state,
   sekce empty state s positive hláškou („Nic nového. Klid.").

## Pošta blacklist rules + PWA ikona (návazná session 31.5./1.6.)

Petr se ptal „je nejake nastaveni pro notifikace? Kde bych mohl zadat
co ignorovat?". Plus chtěl nasadit vlastní PWA ikonu Gide-on pro /start.

### Pošta blacklist (commit `93d0e82`)

- Migrace `20260601000000_posta_ignore_rules` + PostaIgnoreRule model
  (userId + pattern + matchType + label + enabled, index userId+enabled)
- API `/api/posta/ignore-rules/` GET/POST + PATCH/DELETE per id
- Helper `emailMatchesIgnoreRule(fromAddress, fromName, rule)` v
  `notifications.ts`, exportováno pro reuse:
  - contains: substring v from address NEBO name (case insensitive)
  - domain: fromAddress končí `@<pattern>`
  - exact: fromAddress === pattern
- Filter aplikovan ve 3 místech: loadNotifications, countNotifications
  (refactored z .count() na findMany+filter), cron push-notifications
- UI v PushSettings.tsx nová sekce „Ignorovat odesílatele (e-mail)" —
  matchType dropdown + pattern input + label + Přidat, list s ☑ toggle

### PWA ikona Gide-on (~5 iterací)

Petr poslal ZIP s 16 ikonami (orange/cream/ink variants). Trvalo 5 iterací:

1. Orange `apple-touch-icon` do `/icons/gide-on/` → „je tmavá"
2. Nahradit i root `/apple-touch-icon.png` (iOS sahá pro root URL) → „před
   sdílením oranžová, po uložení černá"
3. Identifikoval `favicon.svg` má tmavé pozadí — iOS Safari ho preferuje
   pro Add to Home Screen. Přepsal SVG na orange + manifest bg #FF5C2C →
   „je to na mobilu furt stejne"
4. Cache-bust manifest `id` + `start_url ?icon=gide-on-v2` + `?v=2` →
   screenshot pořád tmavá G
5. Identifikace **iOS 18 Dark/Tinted home screen mode** auto-tintuje
   PWA ikony. Petr poslal `icon-ink-512.png` (dark-by-design) → použito
   jako primary. iOS auto-tint nemá co rozhasit, konzistentně vypadá.

Reusable PWA pitfalls doc: `feedback_ios_pwa_icons.md` v projects memory.

### VAPID rotation

Petr přepsal staré VAPID klíče v .env za nové. Konsekvence: staré
subscriptions v `WebPushSubscription` přestávají fungovat (Web Push váže
endpoint na public key). Naše `sendPushToUser()` na 410/404 automaticky
smaže subscription. Petr musí re-Povolit push na všech zařízeních.

Lesson: VAPID je **one-time setup**, ne pravidelně rotovat. Pokud máš
klíče v produkci, neměnit dokud nejsou skutečné security důvody.

### Co Petr musí udělat po deployi

1. **VAPID** v `.env` (pokud ještě nejsou) → DSM Recreate
2. **Migrace 20260601000000** apply automaticky při container startu
3. **iPhone PWA** fresh install:
   - Smaž starou ikonu z plochy
   - Settings → Safari → Website Data → smazat
   - **Restart iPhone** (Springboard cache flush)
   - Safari → /start → Sdílet → Přidat na plochu (ink Gide-on)
   - Otevřít PWA → /settings/push → Povolit push
4. `/settings/push` → „Ignorovat odesílatele" — přidej noreply / newsletter
   patterns

---

## Page Links modul (večer)

Petr chtěl v sidebaru pod Dashboard záložku „Page Links" + stránku
plnou boxíků jak na /start. Klik = otevře web v novém okně. Settings
NÁZEV, BARVA, URL.

### Implementace (`1d2f2e2`)

- Migrace `20260527170000_page_links` + `PageLink` model
- 4 API endpointy CRUD (GET/POST + PATCH/DELETE per id) s ownership check
- `/links` stránka — grid boxíků target="_blank", styl /start tiles
- `/settings/page-links` + `PageLinksSettings.tsx` — form + TintPicker (8 kruhů)
- Sidebar entry „Page Links" pod Dashboard

### Astro-icon SSR fail (`9f2438f`)

Petr uložil ikony „Immich", „PhotoPrism", „Video" = brand jména, ne lucide
kebab-case. `<Icon name="lucide:Immich" />` na neexistující sprite ID →
SSR throw → `/links` prázdná. Settings ukládala správně, data v DB OK,
API vrátilo JSON s 3 řádky — ale render fail.

Fix: `safeIconName()` helper validuje kebab-case lowercase regex, fallback
na `lucide:globe`. UI hint v PageLinksSettings obohacen o link na
lucide.dev/icons + warning o brand jménech.

Detailní pattern v `~/.claude/projects/.../memory/feedback_astro_icon_validation.md`.

### Klíčové učení

1. **astro-icon na neexistující sprite ID rozbije SSR celé stránky.**
   Nejde jen o tu ikonu — stránka spadne s prázdným responsem nebo build
   error. Pro user-input icon names vždy validate před `<Icon>` render.

2. **Diagnostický postup když UI prázdná**:
   - Browser GET `/api/...` (vidíme data?) — render-side vs server-side
   - DB query (`docker exec ... psql`) — rows existují?
   - Astro logy (`docker logs`) — SSR errory?

---

## Push notifikace cron (večer)

Petr: „resili jsme tu, ze nejdou notifikace pro me". Audit odhalil že
infrastruktura **už existovala** (webpush.ts + sw.js + subscribe endpoint +
PushSettings UI + WebPushSubscription model), ale `sendPushToUser()` měl
**0 call sites** v aplikaci = push fyzicky nikomu nikdy nepřišly.

### Implementace
- 2 nové migrace: `User.pushLastCheckedAt` + 4 boolean filtry
  (`pushVip`/`pushUrgentEmail`/`pushStudankaGuest`/`pushBookingConfirmed`,
  default true)
- `/api/cron/push-notifications` à 5 min — paralelní load 4 zdrojů
  s `createdAt > pushLastCheckedAt`, sendPushToUser pro každou položku
- `/api/push/filters` GET/PATCH endpoint
- PushSettings UI sekce „Co posílat" s 4 toggles (optimistic UI + rollback)
- Max 20 items per source per tick (anti-spam strop)
- První tick baseline = pushLastCheckedAt=NOW, žádný retroaktivní spam

Commits: `f494ec8` (cron), `b2b996c` (filtry).

### Setup po deployi (jednorázově)

1. **VAPID klíče** generovat z kontejneru:
   ```
   docker exec raseliniste_app node -e "
   const wp = require('web-push');
   const k = wp.generateVAPIDKeys();
   console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
   console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
   console.log('VAPID_SUBJECT=mailto:gideon@raseliniste.cz');
   "
   ```
   → vlož 3 řádky do `/volume1/docker/raseliniste/.env` → DSM Recreate.

2. **iPhone**: Safari → raseliniste.cz → Sdílet → Přidat na plochu (PWA).
   Otevři z plochy → /settings/push → Povolit push → Allow.

3. **Filtry**: v /settings/push sekce „Co posílat" zaškrtni jen co chceš.

iOS push vyžaduje PWA + iOS 16.4+. V běžném Safari NEFUNGUJE.

---

## Audit po session (Petr: „pečlivě si projdi a hledej chyby")

Commit `4583065` — 3 reálné bugy nalezené a opravené:

### Bug 1: process-task-audio.ts userId leak

`processTaskAudio({ batchId, audio, mimeType })` neměl userId v interface,
ale řádek 94 volal `extractTaskProposals(transcript, { userId: params.userId })`.
`params.userId === undefined` → AI extrakce dostala kontakty BEZ filtru.

Single-user OK (vrátilo Petrovy), ale multi-user by leakovalo. Plus AI
neměla správný seznam clientSlugy.

Fix: `batch.userId` z DB.

### Bug 2: InlineTitle race condition

`useEffect(() => setDraft(value), [value])` přepsal draft i během editace.
Pokud parent po patchTask udělal optimistic update + reload, value se
změnila → draft přepsán mid-edit.

Fix: `if (!editing) setDraft(value)`.

### Bug 3: cron-schedule.ts type union

`posta-fill-bodies` cron měl `minutes: 10` ale type byl
`5 | 15 | 30 | 60`. Runtime OK (modulo 10 funguje), TS error.

Fix: rozšířit union o `10`.

### Audit checklist pro budoucí session

1. `npx tsc --noEmit -p tsconfig.json` — projít všechny errors aspoň
   triáží. Errors v dnes dotčených souborech jsou priority. Pre-existing
   errors v ne-funkčních souborech skip.

2. Pro každý nový endpoint:
   - `readSession` + 401 fallback?
   - Userownership check pro DB write (pokud multi-user-ready)?
   - Input validation (zod schema)?

3. Pro každou novou Prisma query:
   - userId filter pokud model má userId field?
   - NULL handling (`OR: [{ field: null }, ...]`) pokud filtrujeme NULL hodnoty?
   - AND wraps OR conditions, ne top-level OR konflikty?

4. Pro každý nový React component s controlled inputem:
   - `useEffect(() => setLocal(parent), [parent])` chybí guard pro mid-edit?

5. Pro každou novou migraci:
   - SQL syntax validní?
   - NOT NULL bez DEFAULT? (= produkční migration může failovat na
     existujících rows). Vždy nullable nebo s default.

6. Pro každý změněný prompt:
   - Token limit dostatečný pro očekávaný output?
   - Reasoning model (Gemini 2.5) má explicit `thinkingBudget`?
   - JSON output tolerantní parser pro fallback truncation?

7. Pro každé nové UI tlačítko:
   - 44px+ touch target?
   - Disabled state pendingu?
   - Error banner po fail?
   - Loading spinner?
