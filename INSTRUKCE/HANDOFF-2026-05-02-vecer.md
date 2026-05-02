# HANDOFF — konec session 2026-05-02 večer

**Datum:** 2026-05-02
**Trvání session:** od ranního commitu B&W myš vizualizace (cca 7:00) do večera (21:30+)
**Hlavní téma:** Todoist obousměrný sync, VIP firewall, úkoly, Things import

---

## ⚠️ KRITICKÝ KONTEXT PRO NOVOU SESSION

Petr je vyčerpaný — dnes 7+ hodin debug Todoistu. Ne kvůli features, ale kvůli mým chybným předpokladům o Todoist API:

1. **Předpokládal jsem že GET /tasks/:id vrátí 404 pro completed** — NEPRAVDA. Vrací 200 s `is_completed: true`. Důsledek: 6 hodin reconcile pass nikdy nezavřel žádnou misi/úkol. Opraveno commitem `4d7a618`.

2. **Wishlist 112 položek** — Petr nahrál JSON s `decision: "wishlist"`, moje implementace je uložila jako Knowledge entries místo Todoist tasků. Petr to chtěl v Todoistu. Opraveno commitem `1eb74d6` (one-click button „Smigrovat wishlist do Todoistu").

3. **`due_string` zneužito pro ISO datetime** — natural-language parser, ne timezone-aware datetime. Opraveno: `due_datetime` field, clear přes `due_string=""`. Commit po `4d7a618`.

4. **`Task.todoistTaskId` nebyl unique** — race podmínka při dvojitém push mohla vyrobit duplikáty v Todoistu. Opraveno migrace `add_task_todoist_unique`.

5. **Sync větev neuklízela `completedAt` při reopen** — inkonzistentní stav mezi sync a reconcile pass. Fixed.

6. **Pravidlo:** **NIKDY nedopustit aby Petr testoval na produkci to co jsem si měl ověřit z dokumentace.** Před deploy fundamentálních věcí (sync, push, propagace) projít oficiální Todoist v1 docs (https://developer.todoist.com/api/v1/).

---

## 🟢 STAV: 19 commitů hotových, čeká na PUSH

Nejnovější → nejstarší:

```
4d7a618 fix(reconcile): kontrola is_completed flagu — Todoist nevrací 404 pro completed
1eb74d6 feat(things-import): remigrate-to-todoist — one-click záchrana wishlist
0054d9b feat(ukoly+docs): dynamické tagy v audio extrakci + VIP audit + dokumentace
7a03a96 fix(ukoly): kompletní obousměrná synchronizace s Todoist (4 díry)
bf2340d fix(todoist-sync): reconcile pass přes GET /tasks/:id
faddb69 fix(vip): backfill tlačítko pro existující VIP kontakty bez tokenu
135ab48 fix(ukoly): kritické mezery v Todoist propagaci + UX delete bez confirmu
f7c4fad fix(things-import): priority invert + pre-flight project check
dc43323 feat(cron): tlačítko Reset Todoist sync
4739c66 feat(cron): tlačítko Spustit teď + dry-run
3a41abe feat(things-import): bulk import
7a7fb2c feat(studna-guest): inline návod pro hosty (i ikona)
993d22f feat(todoist): tvorba projektů + labelů z naší appky
c177d69 feat(ukoly): VIP mise sjednocené v /ukoly + pull Todoist projektů
677e2a6 feat(ux): B&W myš audio 5→10 min + Start button
efcbcd5 chore(cron): todoist-sync 30min → 5min
712bf6f feat(studna): per-projekt custom AI prompty
4489902 fix(settings): Crony dlaždice
2dcd3cc fix(studna): regenerate button vždy
... a 6 starších commitů (B&W myš vizualizace, doplněk 2 schema, atd.)
```

**Po push +Container Manager pull se aplikuje 5+ migrací** (todoist sync columns, project mirror, label mirror, decision evaluation arguments, project studna prompts, bwmys doplnek 2 schema, things import, things import tasksource, contact call log token, cron run).

---

## 🚦 CO MUSÍ PETR UDĚLAT PO PUSHI

### 1. Push všech commitů
```bash
cd "/Users/petrperina/CLOUDS/CLOUDE PROJECTS/raseliniste"
git push
```

### 2. Container Manager pull + restart na NASu
```bash
ssh root@SPIZ
cd /volume1/docker/raseliniste
sudo docker compose pull && sudo docker compose up -d
```

Migrace proběhnou samy. Sledovat logy `sudo docker compose logs app --tail 50`.

### 3. DSM Task Scheduler entry (pokud ještě není vytvořený)
Pouze JEDEN entry — viz `Návody/03-crony.html`:
```
curl -fsS -X POST -H "x-cron-key: $(grep ^CRON_SECRET= /volume1/docker/raseliniste/.env | cut -d= -f2-)" --max-time 120 http://localhost:3333/api/cron/scheduler
```
Schedule: Daily, First 00:00, Every 5 minutes, Last 23:55.

### 4. Reconcile spuštění pro vyřízení 8 nezavřených VIP misí
- Otevři `/settings/crons`
- Klik **Spustit teď**
- V response uvidíš `reconciledClosed: 8` (nebo víc)
- Refresh `/call-log?t=hfRqADkRWC3PGbawtQLOpq1j` (Lucii) → mise vymizí

### 5. Wishlist 112 položek — one-click migrace do Todoistu
- Otevři `/things-import`
- V historii klik na detail importu „wishlist_curated.json" (`cmoop0fjq001t01qpdh2p33tm`)
- Klik **„Smigrovat wishlist do Todoistu (one-click)"**
- Auto-create projektu Wishlist + 112 tasků s labely

### 6. VIP backfill tokenů (pokud ještě nepushlé)
- `/contacts` toolbar → **VIP tokeny** → vygeneruje 3 chybějící (Matěj, Petr, Siiima)
- Otevři detail každého → sekce „VIP link (privátní)" → kopíruj URL → pošli VIPům

---

## 📂 KLÍČOVÉ KOMPONENTY (rychlá orientace)

### Todoist obousměrný sync
- **Schema:** `User.todoistSyncToken/SyncedAt/SyncError`, `TodoistProjectMirror`, `TodoistLabelMirror`, `Task.todoistTaskId/ProjectId/PushError`, `CallLog.todoistTaskId/Error`
- **Lib:** `src/lib/todoist.ts` (createTask, updateTask, getTask, closeTask, reopenTask, deleteTask, createProject, createLabel, listLabels, syncFetch)
- **Dispatcher:** `src/lib/todoist-sync.ts` (sync items+projects+labels + reconcile pass přes GET /tasks/:id)
- **Push:** `src/lib/task-todoist-push.ts` (smart routing assignee → projekt/section)
- **Endpoint:** `POST /api/cron/todoist-sync` (cron-key auth)

### VIP firewall (Gideonův Firewall)
- **Schema:** `Contact.callLogToken@unique` (24 znaků base64url), `CallLog.contactId/wasVip/seenAt/todoistTaskId`
- **Lib:** `src/lib/call-log-token.ts` (resolveCallLogToken s defense-in-depth `isVip=true`), `src/lib/vip-missions.ts` (loadVipMissions s STRIKT contactId match)
- **Frontend:** `/call-log?t=<token>` (zadávací + výpis), `/call-log/thanks?t=<token>` (potvrzení + výpis)
- **Backfill:** `/contacts` toolbar tlačítko „VIP tokeny" pro existující VIP bez tokenu
- **Bezpečnost:** cross-VIP průsak fyzicky nemožný (audit 8 míst, viz HANDBOOK)

### Úkoly (`/ukoly`)
- **Schema:** `Task` model (samostatný od `Entry`)
- **API:** `GET/POST /api/ukoly` (sjednocený view: Task + CallLog VIP), `PATCH/DELETE /api/ukoly/:id` (s prefixem `callLog:` pro VIP)
- **Sync:** všechny user-actions propagují synchronně do Todoistu (create, edit, status, delete)
- **Audio diktát:** `/ozvena` → `process-task-audio.ts` (Stage 1 přepis + Stage 2 extrakce s dynamic tagy/kontakty) → `commit.ts` auto-push všech tasků

### Things import
- **Schema:** `ThingsImport` + `ThingsImportItem`
- **Lib:** `src/lib/things-import.ts` (zod schema, executeImport s pinning, preflightProjectCheck, priority invert)
- **API:** `POST /api/things/import` (upload), `POST /:id/execute`, `POST /:id/remigrate-to-todoist` (záchrana wishlist → Todoist)
- **UI:** `/things-import` → file picker → preview → spustit → progress polling

### Cron scheduler
- **1 DSM entry** každých 5 min volá `/api/cron/scheduler` → dispatchuje 16 jobů
- **Schema:** `CronRun` (per-job lastSuccessAt, errorCount, atd.)
- **UI:** `/settings/crons` (tabulka jobs + tlačítka Spustit teď, Dry-run, Reset Todoist sync)

---

## 🟧 TODO PRO NOVOU SESSION

### 🔴 Vysoká priorita

1. **Po-deploy verifikace reconcile** — sledovat zda Petrových 8 VIP misí (Lucie) zmizí z otevřených po `Spustit teď` v `/settings/crons`. Pokud ano → reconcile pass funguje. Pokud ne → další debug.

2. **B&W myš doplněk 2** — schema v DB je připraveno, zbývá 7 bodů z `/Users/petrperina/Downloads/rozhodovaci-system-doplnek-2.md`:
   - UI ve formuláři zápisu — radio buttons stav (aktivovaný/stažený/klidný/nevím)
   - UI v zarámování — krok 2.5 autorství (pro_me/pro_jineho/spolecne/nejsem_si_jisty)
   - AI sekce A2 (rozložení stavů) + F2 (autorství) + rozšíření sekce C
   - Tok 5 — kontrola před uzavřením (dialog 48h pro aktivovaný/stažený poslední zápis)
   - Vizualizace „Mapa stavů v čase" (stacked bar, od 3. zápisu)
   - Vizualizace „Distance-from-self" (scatter, jen finální + relevantní autorství)
   - AI prompt pro klasifikaci motivací vnitřní/vnější

### 🟡 Střední priorita — z auditu Todoist (commit po `4d7a618`)

3. **Latent bug #4 — getTask vs reconcile komentáře** — sjednoceno v posledním commitu, ale ověřit jedním curl voláním proti reálnému Todoist API (otestovat: completed task vrací 200? deleted vrací 404?).

4. **Latent bug #8 — cache fragility v `task-todoist-push.ts:53`**: po `invalidateCache` se neznovunačítají sekce. Funguje, ale fragilní pro budoucí refaktor. Zvážit přepsat na `getCache()` znovu po invalidaci.

5. **Latent bug #9 — DELETE leak když Todoist down**: `DELETE /api/ukoly/:id` lokální delete proběhne i pokud Todoist API selže → leak. Není UI feedback. Fix: přidat audit log nebo retry queue.

6. **Latent bug #10 — Recurring tasks v Todoistu**: naše DB má jen single `dueAt` → desync při Todoist recurrence (next instance se zkopíruje, my si myslíme že je to update starého). Známé omezení, dokumentovat v UI.

### 🟡 UX vylepšení v `/ukoly`

7. **Bulk select + bulk delete** (checkbox per řádek + sticky bottom bar)
8. **TaskAudioReview discard** — taky bez confirm() dialogu
9. **Per-task pushError badge** u řádku (teď jen v rozkliknutém detailu)

### 🟢 Nice-to-have

10. **Idempotency-Key header** při createTask (Todoist v1 podporuje) — eliminuje race duplikáty bez DB unique
11. **Šém kontrakt test** — `tests/todoist-contract.ts` s ručně-spustitelnými curl voláními do reálného API, ověří všechny předpoklady (404 vs 200, due clear, atd.)
12. **Subtask pod completed parent** — edge case, ověřit chování
13. **Token expirace UI** — co se stane když Todoist token expiroval
14. **Pre-existing TS errors** v `env.ts` patternu — drobnost, build prochází

---

## 📚 DOKUMENTACE

- **HANDBOOK.md** — sekce „Plně obousměrná synchronizace s Todoistem" (commit 7a03a96)
- **INSTRUKCE/03-moduly.md** — řádky Todoist sync, VIP isolation
- **INSTRUKCE/04-todo-list.md** — manuální DSM kroky
- **Návody/02-ukoly.html** — sekce 7b (user-facing flow)
- **Návody/03-crony.html** — kompletní cron seznam (16 + scheduler)
- **Tento dokument** (HANDOFF-2026-05-02-vecer.md) — pro novou session

---

## 🎯 PRINCIP, KTERÝ MUSÍ NOVÁ SESSION RESPEKTOVAT

> **Petr používá Todoist jako primary tool. Rašeliniště je sběrna a analyzátor.**
> Propsání MUSÍ být obousměrné, spolehlivé, na všech akcích.
> Pokud něco nefunguje, je to **kritická díra**, ne drobnost.
> Před implementací sync logiky **vždy ověřit Todoist v1 API behavior** v oficiální dokumentaci.

---

## 💬 KOMUNIKACE S PETREM

- Čeština
- Stručně, věcně, bez vaty
- Petr má CPTSD a ADHD — vyhnout se přehlcení, dlouhým výklady
- Jasné akční kroky („udělej X")
- Pokud je něco mé chyby, krátká omluva + fix, ne mnoho slov
- Petr je vyčerpaný — pomoc, ne další zátěž

---

*Konec HANDOFF dokumentu. Audit Todoist schématu běží na pozadí, jeho výsledky doplnit po doběhu.*
