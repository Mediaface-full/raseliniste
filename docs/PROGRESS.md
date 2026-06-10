# Průběh projektu — Rašeliniště

> Živý deník. Aktualizovat po každé velké session. Nová session přečte
> a ví kde se skončilo. Detail jednotlivých session bloků v
> `INSTRUKCE/HANDOFF-*.md` a v memory souborech.

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
