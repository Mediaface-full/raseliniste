# Průběh projektu — Rašeliniště

> Živý deník. Aktualizovat po každé velké session. Nová session přečte
> a ví kde se skončilo. Detail jednotlivých session bloků v
> `INSTRUKCE/HANDOFF-*.md` a v memory souborech.

## Session 2026-09-06 → 09-07 — UX audit: dávky A, B, C + nové menu

Zdroj: `docs/UX-AUDIT-2026-09-06.md`. Commity `a30f09d` (A), `5f0cd40` (menu R3), `1ec90b8` (B), `7b9168d` (C).

- **A (nic nespadne):** tichá selhání → viditelné chyby (UkolyList, CustomRituals, InviteCreator, MeetInbox…), `confirm()` pryč z PWA cest (dvouklik), ContactEditor overlay nezavírá klik mimo, StudnaList „Zkusit znovu".
- **Menu (R3):** 8 skupin podle záměru (Dnes / Vstupy / Kalendář / Práce / Obsah / Komunikace / Lidé a data / Systém), `<details>` podmenu se otevírá na aktivní položce, ⌘K → /zeptat-se, mrtvé položky odstraněny. Breadcrumby stránek srovnány se skupinami (C).
- **B (vidím, co se děje):** paleta Tailwind (red/emerald/amber/blue) → tokeny (`destructive`, `--tint-mint/butter/sky`); `text-black` na tintech → `text-background`; `text-muted-foreground/40–70` bez opacity; `focus:outline-none` bez ringu odstraněn (globální `:focus-visible` outline v Signal); Meet/Plaud inbox chyby+úspěch jako panel s ikonou a zavřením; rituály: chyba vs. Google varování zvlášť; **undo mazání úkolu** (6 s „Vrátit zpět", DELETE až po vypršení / flush při dalším mazání); aria-label na ikonových tlačítkách (title → aria-label), textové hlavičky v tabulce kontaktů (iCloud / Smazat), pošta stav i textem (k potvrzení / urgentní / eskalace), dotykové cíle `p-2`.
- **C (formuláře):** BookingPicker validuje při kliknutí (jméno, příjmení, e-mail formát, téma) + scroll/fokus na pole + `type=tel` + poznámka o časovém pásmu když prohlížeč ≠ Praha; InviteCreator čte předstih z `/api/calendar/settings` (dřív natvrdo 48/12 vs. 72/24!) a CTA je vždy klikací s inline důvodem; ContactEditor validace e-mailů a narozenin + sticky patička + náhled normalizovaného slugu; SchedulingSettings křížová validace oken/limitů + `NumberInput` jde vymazat; rituály čas jako text (vymazatelné) + kontrola přesahu půlnoci; PageLinks `normalizeUrl` (bez schématu → https://), popisky v editaci, chyba u řádku, dvouklik mazání; emoji → lucide (mimo deník, tisk a TrencadisBoard = 1:1 replika designu); HealthAnalysesList na `.modal-overlay`.
- **`&#13;` cleanup dat:** existující endpoint `/api/contacts/cleanup-entities` (tlačítko „Sanitace po prvním iCloud sync" v Kontakty → Nástroje) — na produkci spustit ručně.
- **Otevřené z auditu:** R1 (ConfirmDialog primitiva pro zbylých ~80 `confirm()` mimo PWA cesty), R2 (remap `text-[10px]/[11px]` → `text-xs`), R4 (jednotný toast/alert/skeleton), R5 (Signal rozpočet CTA), R6 (řazení/stránkování tabulek), R7 (dirty check), R8 (Studánka+Prskavka sloučení — čeká na Gideonovo slovo).
- **Pasti:** `focus:outline-none` nikdy bez viditelné náhrady; číselné inputy nikdy `parseInt(...) || 0` v onChange (nejde vymazat); lead time nikdy natvrdo v UI textu.

## SNAPSHOT 2026-09-01 — pevný bod před UX/flow vlnou

> Gideon: „budeme teď dělat hodně úprav přehlednosti a flow" — tohle je
> stav, od kterého se vychází.

**Deploy stav:** origin/main + ghcr latest = `3e183c8`; NEPUSHNUTÝ lokální
commit `6136844` (loop retry + Zahodit potvrzení). Prod NASka: Gideon
pulloval naposledy ~31. 8. (verze s 0f7b1a5? ověřit při další stížnosti
přes asset probe).

**Hotovo od 2026-08-09 (vše commitnuté, většina nasazená):**
- **Plaud → Studánka** (125cf97…3eece65): REST API, tokeny šifrovaně,
  cron à 30 min, MP3 stahujeme a přepisujeme u nás (Gemini) — Plaud sám
  nepřepisuje; první sync = backfill 365 d. ⚠️ ČEKÁ NA GIDEONA: prod má
  mrtvé tokeny z 28. 8. → Odpojit (v prohlížeči, ne PWA — nebo po deployi
  3e183c8 i v PWA) + vložit čerstvé (živé, ve schránce po `plaud login`).
- **Booking balík**: allowWeekend (a50e54b) + allowEvening do 23:00
  (0f7b1a5, přeskočí END_OF_DAY warning) + firemní Meet linky
  (CompanyMeetLink per Contact.company, meetSource CONTACT/COMPANY,
  5889ba7) + „Zadat termín napevno" (directBook, 1c674e1) + „Poslat
  pozvánku" mailem s náhledem / SMS (send-invite endpoint) + archiv
  proběhlých (c4d22e4) + formulář v tónovaných sekcích
  Komu/Schůzka/Termíny/Meet/Poznámky (0f7b1a5).
- **Rituály** (c18c5da): vše CustomRitual řádky, editovatelné časy/dny/
  obsah/upozornění, propis do Google (RRULE); sync-calendars instance
  přeskakuje.
- **Kontakty**: přezdívka (nickname, c49c8e2) — tabulka i editor, sync
  iCloud (vCard NICKNAME) + Google (nicknames).
- **WhatsApp/Twilio**: vlastní sender „Gide-On" +420735920798 Online;
  Content Template podpora (f4a2862, pole Content SID v /settings/whatsapp).
  ⚠️ ČEKÁ: Meta schvaluje šablonu raseliniste_pripominka (první
  raseliniste_notifikace zamítnuta — moc otevřená); po Approved vložit HX….
- **Úkoly audio** (6136844): hallucination-loop retry (2. pokus temp 0.5),
  Zahodit s dvouklik potvrzením (confirm() v PWA nefunguje!). INCIDENT
  2026-08-31: Gideon přišel o hodinovou nahrávku (loop → error → Zahodit
  smazal audio bez ptaní).

**Otevřené (checklist):**
1. Gideon: push 6136844 → zelená → NAS Pull + Recreate
2. Gideon: Plaud — Odpojit + vložit čerstvé tokeny → první sync 17 nahrávek
3. Gideon: WhatsApp — po schválení šablony vložit Content SID
4. Ověřit: pětiúkolová nahrávka z 1. 9. (v review na /ukoly?)
5. Anotace (bublina Poznámka) — nástroj aktivní, oba komenty z 30. 8.
   odbavené (sekce formuláře + večerní výjimka)

**Známé pasti pro UX vlnu:** window.confirm/alert v PWA nefunguje (vždy
dvouklik v UI); Portal pattern pro dropdowny v .glass; non-SOFT WARNING
v rules vyřazuje sloty z nabídky; brand pravidla STRICT
(feedback_brand_palette_rules.md); po prisma generate restart dev serveru;
dev server na portu 4322 (3000 kolize), spouštět se `set -a; source
.env.local` když přes Bash.

## Session 2026-08-07 — cache fix, UX kolo, Meet zprovozňování

**INCIDENT (zapsán i v memory):** „nevidím novou verzi" po deployi NIKDY
nebyla uživatelova cache — SSR HTML se posílalo BEZ Cache-Control a
Safari/iOS si stránky heuristicky kešoval. Stálo Gideona ~3 hodiny přes
několik dní. FIX b25f00c: text/html → no-store, /_astro/* → immutable 1y.
Pravidlo: dvě kola „zkus refresh" = stop, měřit `curl -I` hlavičky.

**UX kolo dle feedbacku:**
- Page Links: viditelné tlačítko „+ Meet dlaždice (na /start)" (sekce MEET
  byla schovaná ve formuláři) + VŠECHNY externí odkazy = čisté <a>, o
  otevření v pravém prohlížeči se stará JEN globální handler v Base
  (lokální window.open hack smazán — dělal okno bez navigace).
- Editor kontaktu: max-w-4xl, dva sloupce, sekce Identita / VIP a oslovení /
  Routing / Narozeniny / Kontaktní údaje (EditorSection helper).

**Meet zprovozňování (stav k tomuto okamžiku):**
- reauth se VŠEMI 3 scopes hotový (chyba ACCESS_TOKEN_SCOPE_INSUFFICIENT
  vyřešena reauthem).
- GCP: OAuth klient žije v projektu **291437574022** — Gideon původně
  zapnul Meet/Drive API v JINÉM projektu; správné enable odkazy s
  ?project=291437574022 mu poslány, zapíná. Po enable ~2 min propagace →
  „Vytvořit místnost" v projektu má projít.
- Nasazeno ručně (lokální image f8546df přes File Station — GitHub měl
  6. 8. výpadek Actions); GH build pak prošel, ghcr srovnané.

Commity: b25f00c, ccd9be3, fef35fe, b93791a (+ docs).


## Session 2026-08-05 → 08-06 — Booking editace, Meet per projekt, MEET dlaždice, GitHub výpadek

**Booking** — editace parametrů pozvánky, dokud si host nevybral termín
(PENDING/VIEWED): tlačítko Upravit + inline form (typ/délka/vztah/sloty od/
platnost/poznámky), PATCH /api/booking/:id/edit. FIX latentní bug: POST
invite schéma neznalo CHOICE_LUNCH_PRAGUE → pozvánka „Oběd v Praze"
padala na 400 (typ existoval od 6/2026).

**Ozvěna** — upload audio SOUBORU má konečně viditelný průběh (XHR %,
„Soubor nahrán ✓", chyba + retry); sdílel tichou fire-and-forget cestu
diktování a nedělal „nic". Diktování mikrofonem beze změny (záměr 5/2026).

**Meet** — místnost per projekt (studánka i prskavka): karta v detailu
projektu, Vytvořit místnost (spaces.create + auto-recording, 3. scope
meetings.space.created = další reauth) nebo navázat link; přepisy z
navázané místnosti se AUTO-přiřazují do projektu (bez inboxu). MeetSpace
+ projectId + spaceName (join na conferenceRecords).

**MEET dlaždice** — PageLink.section="MEET": v Page Links sekce
JMÉNO + link místnosti, na /start sekce „Meet — připojit se" (klik =
otevřít schůzku). iOS PWA x-safari handler přesunut Shell→Base (start_url
ho neměl!). POZOR: sekce na /start se vykreslí až po vytvoření 1. odkazu.

**SRO Manager (jiné repo)** — rozpočty: jednotka položky sleduje účtování
(ročně→rok…), jednotka nově editovatelná; konec „1 měsíc · ročně" v PDF.

**GitHub výpadek 6. 8.** — Actions „job not acquired by hosted runner"
(oficiální incident). Nouzový deploy: lokální `docker buildx build
--platform linux/amd64` → save/gzip → File Station na NAS → `docker load`
+ `docker tag <img> ghcr.io/...:latest` + `compose up -d`. Další normální
pull to přepíše. LEKCE: ověřování prod verze porovnáním hashů lokálního
dist je NEspolehlivé (hash drift lokál vs Docker build) — správně vytáhnout
jména assetů z image (`docker run --rm <img> ls dist/client/_astro`) a ta
probnout na proti produkci.

Commity: 7505d82 … f8546df (+ sro-manager 161f04a).


## Session 2026-08-01 → 08-04 — Trencadís board, Meet přepisy, definitivní kontakty

**Gidiho Týden (trencadís board)** — /planovani kompletně nahrazeno vizuálem
DESIGN/board_work (Gaudí keramické střepy, deterministická geometrie FNV-1a,
den jako mozaika písmen, week taby, tray Volné střepy). Data beze změny
(Task.plannedFor, PlanningBlock, AI návrh, šablona, digest, WIP 3). Po–Pá,
klouzavé týdny; víkendové plánování zmigrováno na pátek (DOW v Europe/Prague!).
Doladění dle feedbacku: chip klienta „1 z 11 úkolů", sbalitelný tray
(localStorage), rozbalení klienta do panelu POD chipy (neskáče), kontrast
meta řádku ≥80 %, fullscreen přes SidebarToggle. Read-only sdílení pro
kolegyni: /b/<token> (PlanningSettings.shareToken, tlačítka Sdílet /
Zrušit sdílení, /b/ public v middleware, data v lib/planning-board-data.ts).
Komponenta: TrencadisBoard.tsx (PlanningBoard.tsx smazán).

**Kontakty — definitivní konec ztracených emailů** — root cause „kontakt
nemá email" (Dlouhý 8×, Suková): tabulka držela změny jen v dirty mapě do
kliknutí Uložit. FIX: AUTOSAVE každé buňky (server hned pushne do iCloudu),
pozvánka nabídne pole pro email přímo (uloží ke kontaktu + iCloud, invite
projde), picker ukazuje email/„bez emailu", input v tabulce min-w 14rem.

**Kalendář** — detail události v denním/týdenním pohledu: theme-aware
modal-panel (dřív hardcoded dark = nečitelné v light) + BlocksToggle
(auto→neblokuje→blokuje) všude; blokování u opakované akce platí pro CELOU
sérii včetně budoucích výskytů (lib/calendar-series.ts: seriesUidOf z
externalId <uid>_<čas>, dědičnost při syncu iCloud i Google).

**Meet přepisy → Studánka** — dle Gideonova návodu, adaptace: OAuth reauth
(meetings.space.readonly+settings, drive.readonly) místo SA+DWD, Gemini API
místo Vertexu. Cron meet-sync à 30 min: conferenceRecords → Drive mp4 →
ffmpeg mono mp3 → transcribeAudioOnly (Files API >14 MB) → zápis
(účastníci/shrnutí/rozhodnutí/úkoly). MeetNote inbox na /studna, přiřazení
k projektu = ProjectRecording + analýza + RAG. MeetSpace = registrované
místnosti s auto-recordingem (spaces.patch self-heal). DEPLOY: reauth +
GCP enable Meet/Drive API.

**Pošta** — fill-bodies 404 smyčka (maily smazané v Gmailu ucpaly frontu,
93 chyb/tick, lastError „Requested entity was not found"): 404 → označit
bodyDeletedAt, pending filtr ho přeskakuje, čistý tick uklidí lastError.

Commity: 29e15e7 … 38e9115 (13). Vše ověřováno v dev (session JWT + seed
+ browser), regression testy kde šlo.


## Session 2026-07-15 → 07-31 — Maraton: ICS kalendáře, Todoist feed, krevní výsledky, ADHD plánování, kontakty fix, velký audit

**~45 commitů (85de5ef … 82a0f1d). Nejdelší souvislá session projektu.**

### Nové moduly a featury

- **Nahrané .ics kalendáře** (`/settings/local-calendars`): upload ICS → CalendarEvent
  se source=LOCAL_ICS, display-only (žádný sync ven, booking neblokují). Recurring
  expanze oknem -1r/+2r. POZOR na ICAL.js jump-forward (viz GOTCHAS).
- **Todoist karta na dashboardu** (`Todoist — tým a hosté`): activity log unified v1
  (probe /activity|/activities|/activity/get), jen akce KOLEGŮ/HOSTŮ (vlastní
  odfiltrované přes GET /user), komentáře explicitně (object_type=note), jména
  z kontaktů + collaborators API, projekt › úkol detail. Týdenní detail
  `/todoist/aktivita` (?vse=1 = i moje).
- **Krevní výsledky** (`/health/krev`): PDF → Gemini flash extrakce (60k tokenů,
  thinking 1024, salvage parser) → HealthLabReport/Result → tabulka posledního
  odběru (mimo normu Signal + šipky ↑↓), SSR grafy vývoje s ref pásmem, trend
  zlepšení/zhoršení/stejné vs minulý odběr, vysvětlivky ~55 analytů na hover
  (vlastní tooltip, ne title), AI shrnutí (reuse HealthAnalysis s krevním focusem),
  lab data v měsíční analýze. + tiskový report tlaku `/health/tlak-report`
  (tabulka Datum|Čas|Sys|Dia + SVG graf, Cmd+P → PDF).
- **ADHD Plánování** (`/planovani`) — kompletní systém dle Gideonova dokumentu:
  F1 board (Task.plannedFor, dny jako řádky, K naplánování po klientech,
  WIP 3/den, schůzky s časy v hlavičce dne), F2 weekly review AI + nedělní
  push 18:30, F3 šablona týdne (PlanningDayTemplate, badge, AI respekt,
  SOFT_THEME_DAY), F4 digest pro kolegyni (cron 7:00 prac. dny),
  **klientské bloky** (PlanningBlock — přetažení celého klienta na den,
  úkoly klienta v bloku automaticky, 1 blok = 1 WIP). Návod v /navody/planovani
  + docs/NAVOD-PLANOVANI.md.
- **Dashboard**: sekce Dnes s reálnými daty (úkoly dnes + naplánované + události
  + zápis dne), Moduly klikatelné (6/8 aktivních), počasí dnes+2 dny (Open-Meteo,
  Jílové, cache 30 min), Plán s odskokem PROBÍHÁ vs denní program, narozeniny
  zvýrazněné.
- **Booking**: událost má blocksBooking override (auto/blokuje/neblokuje, toggle
  v DayView) — Matějův program neblokuje (kromě lékaře dle regex), celodenní
  markery (DOMA…) jen SOFT warning, booking nabídka filtruje všechna SOFT_*.
- **Kontakty**: editace core polí (email/telefon/jméno) auto-push do iCloudu
  s MERGE proti existující vCardě (PHOTO/URL/labely přežijí), pull etag-skip.
- **PWA**: externí odkazy z iOS PWA do pravého Safari (x-safari-https:// scheme,
  globální capture v Shell), Page Links.

### Infrastruktura

- **Repo přesunuto do org Mediaface-full (2026-07-21)**: image nově
  `ghcr.io/mediaface-full/raseliniste/app` (stará /duchnotvor/ cesta je mrtvá,
  ale zůstala veřejně dostupná — past!). Balíček v org musí být PUBLIC.
  Org Settings → Actions → Workflow permissions: Read and write.

### Velký audit 2026-07-31 (commit 82a0f1d)

Gideon: „výpadky funkčnosti, projdi celé komplet." 5 paralelních review →
25+ oprav (ztráta dat v kontaktech při auto-pushi, booking override díry,
duplicitní ERRORy, AI WIP bez bloků, digest spam, SVG gradienty, glossary
kolize, Todoist 429 visení dashboardu…). Detail v commit message 82a0f1d.
Vědomě odloženo: Google pull umí vzkřísit smazaný e-mail (aditivní bez
tombstonů), tabulka sloty bez orderBy, duplicitní iCloud karta únos párování,
RECURRENCE-ID overrides v local-ics (duplicitní výskyt přesunuté instance).

## Session 2026-07-06 — Integrace SRO Manager (Studánka), výchozí Meet link kontaktu

**5 commitů raseliniste + 2 commity sro-manager. Cross-repo práce (poprvé).**

### Integrace Studánka → SRO Manager (obě strany hotové)

Gideon: klientské studánky se mají propisovat do firemního systému SRO Manager
(FastAPI + SQLAlchemy + Coolify na diego, `mediaface_sro/sro-manager`).

**Rašeliniště strana** (`9c5d4d5` + `38c8ce2`):
- `ProjectBox.webhookUrl / webhookSecret / externalClientRef` (migrace `20260706090000`)
- `src/lib/studanka-webhook.ts` — po dokončení přepisu POST JSON (event
  `recording.processed`, transcript + summary + guest + clientRef) s HMAC-SHA256
  podpisem v `X-Raseliniste-Signature`. Retry 0s/2s/10s, fire-and-forget,
  module-level Set proti GC. Hook ve všech 3 dokončovacích bodech
  process-recording.ts.
- Pull API `GET /api/export/studanka?client=&since=&until=&limit=` (Bearer
  `STUDANKA_EXPORT_TOKEN`, middleware whitelist!). `until` cursor pro desc
  stránkování backfillu.
- UI: StudnaDetail Nastavení → sekce „Napojení na SRO Manager" (3 pole).
- Návod pro druhou stranu: `docs/INTEGRACE-SRO-MANAGER.md` (pozor: SRO je
  FastAPI, ne PHP — opraveno v `eb7a113`).

**SRO Manager strana** (`a1f12f9` + `c6d6844` v sro-manager repu):
- Migrace `033_studanka_recordings.sql` (id=recordingId PK → idempotence).
  **Aplikována ručně na prod** přes `ssh diego docker exec db psql` —
  entrypoint migruje jen prázdnou DB!
- `routes/studanka.py` — POST /webhooks/studanka (HMAC compare_digest,
  CSRF exempt přes `_PUBLIC_PREFIXES` += `/webhooks/`), GET
  /studanka/clients/{id}, GET /studanka/backfill (owner-only, stránkuje
  pull API přes `until`).
- `StudankaBox.tsx` na detailu klienta (vzor MeetBox) — bez dat se nerenderuje.
- Ověřeno na produkci: backfill importoval **21 záznamů**.

**Párování:** `externalClientRef` = interní UUID klienta v SRO (na detailu
klienta, klik kopíruje — commit `0e34fff` v sro-manager). Sdílený webhook
secret + export token — hodnoty v .env obou systémů.

### Výchozí Meet link kontaktu (`2ea2cb7`)

Gideon: kontakt s trvalou Meet místností → booking použije jeho link místo
generování nového. `Contact.defaultMeetLink` (migrace `20260706120000`),
confirmReservation: `conferenceData=false` + link do location/description/
mailu/.ics/BookingInvite.meetLink. Pole v ContactEditoru. Caveat: event nemá
nativní „Join with Meet" tlačítko (link je v location — klikatelné).

### 3 bugy nalezené TS auditem (opravené v `2ea2cb7`)

1. **VIP/TÝM toggle save byl rozbitý** (od fb5b341) — zod `Change.field` enum
   neobsahoval isVip/isTeam a `value` nepovoloval boolean → každé uložení
   flagu 400. Lekce: **po přidání case do switche zkontrolovat i zod schema.**
2. **✎ edit modal mazal overlay pole** — tabulka GET nevracel vocative/aliases/
   todoistUserId → editor je otevřel prázdné a save je vynuloval.
3. `EventTypeStr` nemel `MEETING_LUNCH_PRAGUE` (Prisma enum ≠ TS union —
   při přidání enum hodnoty aktualizovat obě místa).

### Další kroky

1. Push obou rep (raseliniste 5 commitů, sro-manager 2) + DSM/Coolify deploy
2. `STUDANKA_EXPORT_TOKEN` do .env na Synology (hodnota u Gideona)
3. Spárovat klientské studánky (ID klienta + webhook URL + secret v nastavení)
4. Test: nahrávka do spárované studánky → karta klienta v SRO
5. Zbývá z minula: rotace Anthropic klíče, triage přešlých úkolů, RAG tool pro bota

---

## Session 2026-06-19 → 2026-07-05 — Deploy redesignu, UX opravy, Oběd v Praze, Telegram bot ClaudeClaw

**~27 commitů na main, vše nasazeno. Memory: `project_telegram_claudeclaw.md`.**

### Deploy redesignu + post-deploy opravy (2026-06-19 … 22)

- Redesign branch (30 commitů) mergnut do main a nasazen. Hosti i VIP bez akce, Petr klik „Restartovat" v PWA banneru.
- **Backup „fetch failed" widget** — 2 bugy: SchedulerStatus 60s grace nefungoval pro daily joby (fix: porovnat lastSuccessAt vs lastTriggeredAt) + manuální GET /api/cron/backup neaktualizoval CronRun (fix: recordCronRun v POST i GET). `posta-commitment-detect` → fireAndForget (LLM > 90s timeout).
- **UX batch dle Gideonova feedbacku:** health „Analyzovat" z lavender na brand; kalendářový event modal čitelný v dark theme (hardcoded OKLCH → modal-panel); Kontakty: Nástroje dropdown + zvýrazněný search + odfialovění + klikatelné VIP/TÝM flagy + ✎ edit modal s VIP odkazem + sloupec Poznámka; Triage: 2řádková hierarchie + collapsed list s meta chips + Rozbalit/Sbalit vše; Úkoly: kompaktní 1-row + ✕ discard batchů + neutral status ikony; **fix VIP filtru asignace** (CallLog mise ignorovaly assignedTo) + **fix commit endpointu** (batch zůstával v review když část tasků selhala — try/catch + force status update); booking: brand pozadí + vykání; /ozvena + /notifikace: Shell na desktopu, PWA scope na /ozvena/pwa (manifest id zachován); dashboard: 2× QuickRecordButton (úkoly + deník, klik=start/stop, timer, bez redirectu); Page Links sjednoceny na /settings/page-links (stará /links po 5 marných fixech zrušena → redirect); apple-touch-icon na cream variantu (Mac dark dock auto-tintoval transparent PNG).
- **Booking „Oběd v Praze"** — nový typ CHOICE_LUNCH_PRAGUE / MEETING_LUNCH_PRAGUE, 90 min fix, okno 11:00–13:30, dny v /calendar/settings (lunchDays), dovolená/nomád blokují (isInPerson). Migrace `20260619200000_booking_lunch_prague`.

### Telegram bot ClaudeClaw (2026-06-22 … 2026-07-05, LIVE)

- **Stack:** `@anthropic-ai/sdk` + Claude Haiku 4.5 (env `ANTHROPIC_MODEL` override), beta toolRunner, 4 read-only tools nad Prisma: get_tasks / get_events / get_schedule / get_studanka_activity. Factory `buildAgentTools(userId)` (userId v closure). Webhook `/api/telegram/webhook` (secret header + whitelist user ID), fire-and-forget, /start + /help.
- **Hlasovky:** Telegram OGG → `transcribeAudioOnly()` (Gemini, sdílená pipeline se Studánkou) → bot pošle `🎙 „přepis"` → agent.
- **Debug maraton (~2h, lekce v GOTCHAS):** (1) compose bez explicit env řádků — VAPID lekce znovu; (2) webhook secret se spec. znaky rozbil shell i Telegram validaci — jen hex; (3) **hlavní bug: middleware blokoval webhook** — `/api/telegram/webhook` chyběl v `isPublic()` → 401 UNAUTHENTICATED dřív než se endpoint spustil; (4) bot ukazoval smazané schůzky — chyběl `deletedRemotely: false` filtr (ověřeno SQL: 6 ze 7 zobrazených eventů bylo smazaných).
- **Env:** ANTHROPIC_API_KEY, ANTHROPIC_MODEL, TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID, TELEGRAM_WEBHOOK_SECRET (+ explicit řádky v compose).

### Další kroky

1. Rotace Anthropic API klíče (prošel chat transcriptem při debugu)
2. Triage ~15 high-priority úkolů s termínem přešlým o měsíc (špiní botové odpovědi)
3. RAG tool `search_notes` pro bota (přes searchSimilar v rag.ts) — až Gideon narazí na dotaz nad poznámkami
4. Off-site backup na fridu (BACKUP_REMOTE_* env nenastaveny — jen lokální záloha, spawnut task chip)

---

## Session 2026-06-18 / 2026-06-19 — Gide-on brand redesign + Studánka dokumenty + Kontakty sjednoceny

**30 commitů na separátní branchi `claude/redesign-gideon` (worktree `redesign-gideon`).**
**STAV: hotov, čeká na Petrovo "pushni" → merge do main → DSM Pull/Recreate.**

Memory: `session_2026_06_18_19_redesign_gideon.md`, `feedback_brand_palette_rules.md`.

### Co bylo uděláno (fáze A–H)

| Fáze | Obsah |
|---|---|
| A | Brand tokens — Ink `#0E0E10` / Cream `#F4EFE6` / Signal Coral `#FF5C2E` / Teal `#1B4E50` / Sand `#EAC9A2` + teplá grayscale. Space Grotesk Variable (sans+display) + JetBrains Mono Variable (eyebrow/čísla). Light+dark theme přes `[data-theme]` + localStorage `"gide-on-theme"`. Bootstrap script v Base.astro pre-render proti flash. |
| B | `GideonWordmark.tsx` (pure CSS scalable wordmark se switchem) + `GideonMark.tsx`. Assets v `public/brand/`. PWA manifest `id="/start-gide-on-v3"` zachován (= upgrade, NE reinstall). 8 module ikon. |
| C | UI primitives — Button (default/ink/outline/ghost/secondary/destructive/glass), Input (clean + Signal focus ring), Card, Eyebrow (`↳ TEXT` mono), Switch (brand toggle motiv). |
| D | Shell + sidebar polish — odstraněn `bg-white/N` hardcoded (lámal light theme), accent token pro hover/active, font-size 17px. |
| E | Per-modul stránky polish + **emoji strip (228 emoji odstraněno přes 67 souborů)**. Briefing tab inverted segmented pattern. Topbar ikony 18px, h1 brand display `text-4xl bold tracking-[-0.04em]`. |
| F | Public stránky — `/login`, `/me/[token]`, `/call-log`, `/i/[token]` dostávají `GideonWordmark` místo modré ikony „G" / AnimatedG. |
| G | PWA SW auto-update — `VERSION="gide-on-v1"`, postMessage `SW_UPDATED`, `SwUpdateBanner.tsx` coral „Nová verze připravena → Restartovat". |
| H | Final polish — shadow-black/N override v light, ring-2 odstraněn z AwayManager (Petr „zdvojená čára není v brandu"), GuestGuide info button decentní. |

### Nový feature: Studánka — upload dokumentů + RAG

- **Migrace** `20260619180000_studanka_documents`: `ProjectFile.guestUserId` (FK GuestUser, SetNull) + `extractedText` + `extractionStatus` + `extractionError`. GuestUser.files relation.
- **`src/lib/document-parser.ts`** — pdf-parse + mammoth + xlsx (SheetJS) + native TXT. `detectDocKind()` (MIME + extension). Max 100k chars truncate. Dynamic import pdf-parse (side-effects on import).
- **Endpoint** `/api/me/[token]/upload-document` — auth přes guestToken + `canUploadAudio` flag (sdílený). Rate 30/h. Max 50 MB. Fire-and-forget: parse → extractedText → `indexEntity(sourceType: "project-document")`.
- **RagSource** type rozšířen o `"project-document"` v `src/lib/rag.ts`.
- **Frontend** `GuestRecorder.tsx` — `isDocumentByName()` heuristika, endpoint selection (audio/* → upload-audio, ostatní → upload-document). Accept attribute PDF/DOCX/XLSX/TXT.
- **Admin** `StudnaDetail.tsx` zobrazuje `extractionStatus` inline badge + jméno hosta. `/me/<token>` host vidí svých posledních 5 dokumentů + status.
- **Návod** `/help/upload-audio` přepsán pro oba flow (Audio = transkript, Dokument = extrakce + RAG search).

### Sjednocení kontaktů

- Smazán `ContactsManager.tsx` (939 řádků card view) + `src/pages/contacts.astro`.
- `ContactEditor.tsx` extrakce do samostatného souboru (shared modal pro „Upravit kontakt" v tabulce).
- `/contacts/tabulka` → `/contacts/index.astro` (= `/contacts`).
- `/contacts/tabulka` 301 redirect na `/contacts` (backward compat).
- Sidebar zjednodušený — jen položka „Kontakty".

### Drobné polish

- Triage projekt picker Folder ikona (po emoji strip).
- Popover background brand-aware (border-border + bg-popover místo border-white/20 + bg-black/95).
- **10 fullscreen modalů refactor** na `modal-overlay` + `modal-panel` utility (Petr nesnášel agresivní `bg-black/60 + backdrop-blur-sm + glass-strong`).
- Page wrappers `max-w-2xl..7xl` → `100% !important`.
- AwayManager Dovolená/Nomád: border-2 + ring-2 → border-1 + bg tint.
- DiktatRecorder + GuestRecorder mic + upload na brand paletu (Signal Coral CTA, ne tint).
- Studánka host info button: tint-sky modrá → border-border neutral subtle.
- Mood emoji v Deníku ZACHOVÁNY (záměrně, expresivní modul).

### PWA upgrade chování (kritické)

Manifest `id="/start-gide-on-v3"` **zachován stejný jako produkce** = upgrade, ne reinstall.

| Kdo | Akce po deploy |
|---|---|
| Hosti Studánky `/me/<token>` | NIC — nemají SW, otevřou link, vidí nový brand. |
| VIP `/call-log?t=<token>` | NIC — link z emailu, nový brand při dalším otevření. |
| Petr (Gide-on PWA iPhone) | Coral banner „Nová verze připravena → Restartovat". Stará ikona zůstává, push subscriptions přežijí. |
| Petr (Chrome PC) | Hard refresh (Cmd+R). |

### Deploy plán (až Petr řekne „pushni")

1. Merge `claude/redesign-gideon` → `main` (FF z worktree).
2. Push origin.
3. GH Actions build (~7 min — nové npm deps `pdf-parse` + `mammoth` + `xlsx`).
4. DSM Container Manager → Pull → Recreate.
5. Entrypoint: heal-migrations → migrate deploy (`20260609180000` + `20260619180000`) → start.
6. Smoke test: login, kalendář, `/contacts`, `/me/<existing>`, `/call-log?t=<existing>`.
7. Verify migrace: `docker exec raseliniste_db psql ... "\d \"ProjectFile\""` — vidět nové sloupce.

### Co se naučilo

- **Brand identity = palette + typo + tinty per-modul. Mixing per-modul tinty s CTA působí mimo brand.** Mic = vždy Signal Coral, ne tint-butter. Per-modul tint je orientace (sidebar/eyebrow/tile), brand paleta je akce.
- **`bg-white/N`, `border-white/N`, `bg-black/N`, `shadow-black/N`** byly všude jako legacy Liquid Glass. Refaktor 134+ jednotlivě nedával smysl → CSS overrides v `global.css` per data-theme.
- **`backdrop-filter` v glass parent láme `position: fixed`** containing block (Portal pattern z 2026-05-05 platí pro VŠECHNY dropdowny v glass kartách).
- **PWA manifest `id` = identita PWA**. Stejné = upgrade (push subscriptions přežijí), jiné = force reinstall. NIKDY měnit při běžném deployi.
- **`pdf-parse` má side-effects on import** (otevírá test PDF z node_modules). Dynamic import + fallback `mod.default ?? mod`.
- **Modální pattern**: `modal-overlay` (subtle ink 35% v light, 70% v dark) + `modal-panel` (var(--surface-elevated) + border + soft shadow). Nahrazeno 10× `bg-black/60 + glass-strong rounded-xl`.

---

## Session 2026-06-09 (večer) — Triage picker, Team Workspace routing, Portal audit

**8+ hodin práce, ~10 commitů. Petr právem frustrovaný že většina toho
mělo být hotové dřív (Cesta B z 2026-05-18, Portal pattern z 2026-05-05).**

### Co bylo uděláno

1. **VAPID push notifikace deploy** (dopoledne, ~4 h debugging)
   - Petr přepsal `.env` na NASce, kontejner je neviděl
   - Root cause: `docker-compose.yml` neměl `VAPID_*: ${VAPID_*:-}` řádky
   - 6 Synology pitfallů (DSM ACL read-only, busybox sed/awk, awk match 2× → YAML duplicate keys, .env ≠ automatic inject, HTTP 000 timeout)
   - Po dořešení: subscription Mobil v DB, test push doručen ✅
   - Memory: `session_2026_06_01_blacklist_pwa.md` sekce 4

2. **Page Links — otevřít v Chromu** (commit `1b8dcd6`)
   - target="_blank" v PWA otevíral v in-app browser
   - Fix: data-external-link + inline script s window.open(url, '_blank', 'noopener')

3. **AI prompt subjektová pozice** (commit `5dfa2de`, **neúplný**)
   - „Dominik zajistit X" nezachycen jako přiřazení Dominikovi
   - Rozšíření patterns o subjektovou pozici v `ai-prompts.ts:110`
   - Po deployi STÁLE nepomohlo — Gemini interpretoval „Dominik zajistit Y" jako „zajistit u Dominika Y"

4. **Manuální picker projektu/sekce v Triage** (commit `fdbc9dd`, klíčový)
   - Petr právem: „je mi to k ničemu, když nepřiřadí projekt"
   - **Tato feature měla být součástí Smart routing release (2026-05-10)**
   - Migrace `20260609180000_task_manual_routing` — 2 nullable pole Task
   - API endpoint `/api/todoist/projects-list` (cached projekty + sekce on-demand)
   - UI `ProjectPicker` — chip 📁 klikatelný dropdown
   - commit endpoint accepts manualTodoistProjectId/SectionId
   - `task-todoist-push.ts` skip resolveRoute když manual set
   - AI prompt posílen 5 few-shot examples + explicit anti-pattern

5. **Portal fix pro picker dropdown** (commit `c8f6bf2`)
   - Dropdown byl za další kartou kvůli glass parent backdrop-filter
   - **Pattern byl v memory `feedback_calendar_fixed_positioning.md` od 2026-05-05** — měl jsem ho aplikovat hned
   - Fix: createPortal + position:fixed + getBoundingClientRect

6. **Team Workspace routing pro členy týmu** (commit `67c806a`)
   - Routing pravidlo #3 (`isTeam=true`) mělo hardcoded „Práce" / sekce
   - Petrův setup: každý člen = vlastní top-level Team Workspace projekt
   - **Tento gap měl být fixován při Cestě B (2026-05-18)** — pravidla #1 a #2 jsem aktualizoval, #3 jsem přehlídnul
   - Nová `resolveTeamMemberProject()` v `todoist-workspace.ts`
   - Match strategie: exact ci match firstName/displayName/aliases → slug match
   - Fallback na hardcoded „Práce" pokud TWS projekt neexistuje
   - Client-side `computeRoutePreview` zrcadlí logiku

7. **TriageList Portal fix** (audit nález)
   - „Změnit typ" dropdown měl stejný z-20 bug
   - Stejný pattern fix: createPortal + getBoundingClientRect

### Audit dnes — co se našlo

- ✅ **`task-todoist-push.ts`** routing #3 fixed
- ✅ **`TaskAudioReview.tsx`** computeRoutePreview fixed
- ✅ **`TriageList.tsx:528`** „Změnit typ" dropdown — fixed (Portal)
- ⚠️ **`posta-commitment-sync.ts`** — vytváří Todoist task **bez project_id/section_id** → končí v Inboxu. Není to bug nutně (Petr možná chce centrální inbox závazků), ale stojí za pozornost — pokud chce, použít stejný routing pattern jako Task
- ✅ **timeline/data-loader.ts** — používá `workspaceId` properly
- 📋 **15 React komponent** s `absolute` pozicí bez `createPortal` — většina ne dropdown (search ikony, decorative blobs), ale **doporučuji audit při příští session**:
  - `BwMysDetail.tsx` action buttons (asi OK, ne dropdown)
  - `ContactsTable.tsx` search ikona (OK)
  - `IntegrationsSettings.tsx` Key ikona (OK)
  - Zbývá grep verify pro NotesList, DenikList, QuickAdd, IngestSetupGuide, ContactsManager, LettersArchive, ShortcutsGuide, BwMysDetail, MailSettings, ReportsSettings, JournalFeed

### Lesson — proč to bylo dnes špatné

Petr právem: „procti si co jsme vsechno resili to uz je podruhy."

Konkrétní opakování dnes:
- **Portal pattern** byl v memory od 2026-05-05 (5 týdnů). Ignoroval jsem ho při psaní ProjectPickeru.
- **Team Workspace routing #3** byl gap od Cesty B (3 týdny). Pravidla #1/#2 jsem aktualizoval, #3 ne.
- **Manuální picker projektu** měl být součástí Smart routing od dne 1 (4 týdny zpět). Petr neměl escape pro AI chybu.
- **AI prompt z reálných transkriptů** — psal jsem ho ze stolu, anglickou logikou, místo abych si vytáhl 10 reálných Petrových diktátů z `TaskAudioBatch.rawTranscript`.

**Změna workflow** (zapsaná v `feedback_smart_routing_needs_escape.md` + tento PROGRESS.md):
- Před každou změnou v UI / routing / AI prompt: **grep memory soubory aktivně** na téma (`portal`, `dropdown`, `workspace`, `routing`, `prompt`, `transcript`)
- Před implementací nové feature s AI-driven decisionem: **manuální override checklist**
- Před commitem audit: projít memory za poslední měsíc (dnes proběhlo až ex-post)

### Stav po dnešku

Commitnuto v worktree, 7 commitů čeká na push do origin:
1. `00118ae` docs strukturovaná dokumentace
2. `1b8dcd6` Page Links Chrome
3. `5dfa2de` AI prompt subjektová pozice
4. `fdbc9dd` Triage picker + posílený prompt
5. `c8f6bf2` Picker přes Portal
6. `67c806a` Team Workspace routing pro členy
7. (nový) TriageList Portal fix

Petr pushne přes GH Desktop → build → DSM Pull + Recreate.

### Další kroky

- Verify že po deploy „Dominik zajistit Petě X" → Triage chip 📁 ukáže **„Dominik"** (Team project) → Todoist task v Team WS projektu Dominik ✓
- Audit zbylých Portal kandidátů (12 komponent)
- Audit posta-commitment-sync zda má jít do projektu (ne Inboxu)
- POSTA fáze 7 (mobile inbox + AI reply) — naplánováno
- WebAuthn passkey UI dokončit

---

## Aktuální stav (2026-06-07)

**Produkce běží** na `https://www.raseliniste.cz` (Synology DS718+).

### Funkční moduly
- ✅ **Auth** (single-user, argon2 + JWT v cookie, rate limit)
- ✅ **Dashboard `/start`** (3-sloupcový redesign 2026-05-27 + Notifikace tile)
- ✅ **Úkoly** (`/ukoly` + Triage screen + Smart routing 6-úrovňový + inline edit)
- ✅ **Deník** (`/denik` + audio upload + AI extract + viditelné metadata)
- ✅ **Kalendář** (`/calendar` — iCloud CalDAV + Google Calendar + Timeline View)
- ✅ **Booking** (`/calendar/invite` — token-based + collision detection + Meet link)
- ✅ **Studánka** (`/studna` — projekty s hosty + audio + AI summary)
- ✅ **Prskavka** (`/prskavka` — solo audio recording + AI)
- ✅ **Kontakty** (`/contacts` + iCloud CardDAV + Google sync + duplicates + Find&Replace)
- ✅ **Pošta** (`/posta` — F1-F6 + blacklist rules)
- ✅ **B&W Myš** (`/bwmys` — rozhodovací systém + Decision Compass)
- ✅ **Spíž** (`/spiz` — file shares 14d expirace)
- ✅ **Health** (Apple Health import + dashboards)
- ✅ **Notifikace** (`/notifikace` — agregace + blacklist + Web Push)
- ✅ **Page Links** (`/links` + `/settings/page-links` — user shortcuts)
- ✅ **AI dotaz** (`/zeptat-se` — RAG pgvector + Gemini)
- ✅ **Letters** (`/letters` — scan + OCR + odeslat)
- ✅ **Návody** (`/navody` — uživatelská dokumentace)
- ✅ **Web Push notifikace** (per-source filtry + blacklist + iOS PWA)

### V čem se aktivně iteruje
- ⏳ POSTA fáze 7 (mobile inbox + AI reply Petrovým jazykem) — TODO
- ⏳ WebAuthn passkey UI — model existuje, UI rozpracované

### Známé limity
- Things-import 217 mailů zbývá v `Downloads/things-finale.md` (manuální)
- Pre-existing TS errors v `PushSettings.tsx`, `seed.ts`, `audio-transcribe.ts`, `contacts-export.ts` (runtime OK)

## Session 2026-06-01 — VAPID + iOS PWA finále

**Cíl**: Dotáhnout push notifikace na iPhone PWA.

### Co bylo uděláno

1. **Pošta blacklist rules** (commit `93d0e82`)
   - `PostaIgnoreRule` model (userId + pattern + matchType: `contains`/`domain`/`exact` + label + enabled)
   - Migrace `20260601000000`
   - CRUD endpointy `/api/posta/ignore-rules/`
   - Helper `emailMatchesIgnoreRule()` exportován z `src/lib/notifications.ts`
   - Integrace ve 3 místech: `loadNotifications`, `countNotifications`, push cron
   - UI v `PushSettings.tsx` sekce „Ignorovat odesílatele (e-mail)"

2. **PWA ikona Gide-on** (commity `f0956f7` → `b43d022`)
   - 5 iterací (orange → dark → SVG fix → cache-bust → ink final)
   - Použit `icon-ink` variant (dark-by-design) pro iOS 18 tinted mode
   - `manifest-start.json` id + start_url query string pro fresh cache

3. **VAPID rotation deploy** (řešeno v terminálu)
   - Petr přepsal `.env` na NASce
   - `docker-compose.yml` **neměl** `VAPID_*: ${VAPID_*:-}` řádky
   - Vyřešeno přes `awk` block (po `chmod 644`, kvůli DSM ACL)
   - YAML duplicate keys → smazat druhou trojici
   - Po `docker compose down && up -d` kontejner vidí VAPID ✅

4. **Test push** úspěšný
   - DB `WebPushSubscription`: 1 řádek (Mobil, 2026-06-01 07:20:43)
   - PUT `/api/push/subscribe` → push dorazil na iPhone ✅

### Co bylo zjištěno

- **Docker Compose `.env` ≠ automatic inject** — vyžaduje explicit
  `${VAR:-}` řádek nebo `env_file:` direktivu
- **Synology DSM compose má `r-xr-xr-x` ACL** by default — `chmod 644` před edit
- **Synology shell nemá nano** — jen vi/awk
- **busybox sed `\n` escaping** nefunguje, použít `awk` s `print` statements
- **Awk match na pattern může sednout 2×** (kdykoli pattern obsahuje `${VAR:-}` substituci)
- **HTTP 000** = curl timeout signal, ne validní response
- **iOS 18+ Dark/Tinted home screen** auto-tintuje PWA ikony, PWA
  nemůže dodat dark variantu (jen native apps přes Asset Catalog)
- **Před DB query VŽDY Read `prisma/schema.prisma`** — hádal jsem
  `userAgent` místo `label` 2×, Petr právem vytkl

### Kde se skončilo

✅ Push notifikace **live** — kompletní pipeline funguje:
VAPID v kontejneru → subscription v DB → web-push → Apple gateway → iPhone

Petr může:
- Otevřít `/settings/push` → zaškrtnout které notifikace (VIP CallLog / urgent email / Studánka recording / booking confirmed)
- Přidat blacklist patterns pro noreply / newsletter domény
- `/notifikace` agreguje feed (filtrované stejnými pravidly)

### Další kroky (prioritizované)

1. **POSTA fáze 7** — mobile inbox + AI reply (`INSTRUKCE/POSTA-PHASE-7-PLAN.md`)
2. **WebAuthn passkey UI** — model existuje, dokončit `/settings/passkey`
3. **Pre-existing TS errors** — cleanup `PushSettings.tsx`, `seed.ts`, `audio-transcribe.ts`
4. **Things-import** — manuální triage 217 mailů
5. **GCP Billing alerts** (TODO `todo_gcp_billing.md`) — Petr chce vidět reálné náklady

### Otevřené problémy

- žádné

---

## Session 2026-05-31 → 2026-06-01 (návazná) — Blacklist + PWA

Detail v memory `session_2026_06_01_blacklist_pwa.md` (200+ řádků).

---

## Session 2026-05-27 (večer) — Dashboard feedback (26 bodů, ~20 commitů)

Plný handoff: `INSTRUKCE/HANDOFF-2026-05-27-DASHBOARD-FEEDBACK.md`.

### Hlavní bloky

- **`/start` redesign** (grid-cols-3, sloučení Úkoly+Deník→Ozvěna, Studánka+Prskavka→Záznamy, smazat Týden, „Dnes nadchází" karta)
- **`/notifikace` modul** (agregace urgent mail + Studánka recordings + VIP CallLog)
- **Briefing tab Dnes/Zítřek** v DayView (default Zítřek)
- **Manual Sync + Hide event** v DayView (workaround Google delays)
- **Google sweep guard tolerantní** (errorRate<10% místo errors===0)
- **VIP kdy vyrazit** = explicit `reminders.overrides` + location field per `slot.type`
- **Pošta classify tolerantní parser** (extractFirstBalancedObject, 49/50 errors → 0-5)
- **Mobile EditInline panel** v UkolyList
- **Studánka↔Prskavka switch** v cílových stránkách
- **AI metadata viditelná v deníku** (@lidé + #tagy chip listy)
- **Page Links modul** (`/links` + sidebar + custom ikony)
- **Push notifikace cron** (`/api/cron/push-notifications` — propojení existující infrastruktury)
- **Per-source push filtry** (`pushVip`/`pushUrgentEmail`/`pushStudankaGuest`/`pushBookingConfirmed`)
- **Audit pattern** (po session vždy `npx tsc --noEmit` + grep newly added kód → 3 bugy nalezeny)

---

## Session 2026-05-27 (dopoledne) — Big day (~26 commitů, ~1500 řádků)

Plný handoff: `INSTRUKCE/HANDOFF-2026-05-27.md`.

### Hlavní bloky

- iCloud sync auto (cron 30min + onMount /contacts)
- Booking polish (.ics attachment + Meet link persist + diagnose endpoint + slot kolize fix + availableFrom + publicNote + vykání + Google event bez markdown + NULL bug ve filtru listu + viditelná chyba + server log)
- SMTP2GO migrace
- `/start` (tile Týden, celé jméno narozeniny, audio sekce dolů)
- `/ukoly + Triage` (inline editace všeho, chip „📁 Projekt / Sekce", kontrast, šířka)
- Todoist `responsible_uid` (Contact.todoistUserId + collaborators endpoint)
- Audio upload mobile fix (direct file picker, mobile Safari anti-popup workaround)
- AI extract žádný strop (token limit 60k, thinkingBudget 4096, prompt přepsán — verified 29min audio: 5 → 36 úkolů)
- Processing screen viditelnost (fáze 1/2, stopky, warning >5min)
- 4 migrace (`20260525{20,21,22,23}0000`)

---

## Starší session (chronologicky)

- **2026-05-19/20** — Timeline View modul F1-F5 + Todoist Team Workspace
  - Detail: `session_2026_05_20_timeline_view.md` + `session_2026_05_18_todoist_workspace.md`
- **2026-05-17** — Docker Alpine + Node = UTC default, vždy ověř TZ
  - Detail: `feedback_docker_timezone.md`
- **2026-05-16** — Kontakty modul F1-F8 + 17 polish commitů
  - Detail: `INSTRUKCE/HANDOFF-2026-05-16.md` + `INSTRUKCE/CONTACTS-IMPLEMENTATION.md`
- **2026-05-13** — Booking modul kompletní + Pošta scope fix + Todoist 429 retry
  - Detail: `INSTRUKCE/HANDOFF-2026-05-13.md`
- **2026-05-10** — Triage UI s t-* dropdown + Smart routing 6-úrovňový + Alias systém
  - Detail: `INSTRUKCE/HANDOFF-2026-05-10.md` + `INSTRUKCE/SMART-ROUTING.md`
- **2026-05-07** — Spíž + UPLOAD + fire-and-forget napříč
  - Detail: `INSTRUKCE/HANDOFF-2026-05-07.md`
- **2026-05-05/06** — Calendar Portal fix + iCloud RODINA recurring fix + Návody + B&W Decision Compass
  - Detail: `INSTRUKCE/HANDOFF-2026-05-06.md`
- **2026-05-02** — Todoist obousměrný sync (Cesta A)
  - Detail: `session_2026_05_02_todoist_sync.md`
- **2026-04-30** — BIG SESSION 18 commitů (RAG `/zeptat-se` + Studna `/aktivita` + VIP Firewall + tree icon)

---

## Stav repu (2026-06-07)

- Branch: `claude/<branch>` v `.claude/worktrees/busy-kowalevski-490e34/`
- Last commit: `8ac2a74` (docs: pošta blacklist + iOS PWA pitfalls + VAPID rotation do paměti)
- Origin/main: fast-forwarded ze všech worktree commitů (Petr pushuje GH Desktopem)
- Production deploy: aktuální (ghcr.io build OK, DSM Pull OK)
