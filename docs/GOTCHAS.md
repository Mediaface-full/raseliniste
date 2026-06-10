# Pasti a záludnosti — Rašeliniště

> **Nejcennější soubor — šetří hodiny debugování.**
>
> Pokud při práci narazíš na netriviální problém co trvalo > 30 min:
> **zapiš ho sem**. Plus podívej se sem **před** velkými změnami.

---

## Infrastruktura

### Rašeliniště běží na Synology NAS, NE na `diego`/Hetzneru

**Problém**: Předchozí Claude session opakovaně pletla raseliniste se servery
z `~/.claude/CLAUDE.md` (Mediaface deploy guide).

**Příčina**: SSH alias `diego` v `~/.ssh/config` patří jinému projektu.

**Řešení**: Raseliniště = Synology DS718+ v Petrově domácí síti. Deploy přes
GitHub Actions → ghcr.io → DSM Container Manager (manual Pull). Doména
`raseliniste.cz` přes DSM Reverse Proxy + Let's Encrypt. App port **3333**
(ne 3000 — kolize s DSM).

**Soubor**: `CLAUDE.md` (kořen), `SYNOLOGY_DEPLOY_PATTERN.md`,
memory `feedback_completeness_lesson.md`.

### Petr nepushe z terminálu

**Problém**: Pokud zavoláš `git push`, selže s auth chybou.

**Řešení**: Claude commitne lokálně (`git commit`), Petr pushne přes
**GitHub Desktop**. Plus pro worktree commity:
```bash
git -C /Users/petrperina/CLOUDS/CLOUDE\ PROJECTS/raseliniste merge --ff-only claude/<branch>
```
aby se commity dostaly do `main` a Petr je v GH Desktop viděl.

**Soubor**: memory `feedback_worktree_propagate_to_main.md`.

---

## Docker / Deploy

### Docker Alpine + Node = UTC default

**Problém**: Booking nabízel sloty 11-18 místo 9-16. Crony běžely o 2h posunuté.

**Příčina**: Container běžel v UTC, `setHours(9)` = 11:00 CEST v browseru.
Synology Alpine nemá `tzdata` by default.

**Řešení**:
- `TZ=Europe/Prague` v `docker-compose.yml` `environment:`
- `apk add tzdata` v Dockerfile (Alpine ho nemá)
- Před čas-citlivými featurami (booking, crony, digesty) grep
  `setHours\|getHours\|toLocaleString` a ověřit tz
- **Diagnostic endpoint pattern**: GET co vrátí `process.env.TZ` + sample
  `setHours(N)` výstup ušetří 30 min spekulací

**Soubor**: `Dockerfile`, `docker-compose.yml`, memory `feedback_docker_timezone.md`.

### Synology DSM compose soubor je read-only by default

**Problém**: `sed -i docker-compose.yml` selhal tichu (žádný error).

**Příčina**: DSM ukládá compose s `r-xr-xr-x+` (read-only + extended ACL).

**Řešení**: `chmod 644 docker-compose.yml` před editací. Pokud nano není
(Synology shell má jen vi/awk), použít:
```bash
awk '/MATCH_PATTERN/{print; print "NEW_LINE"; next}1' input > /tmp/new && cp /tmp/new input
```

**Pozor**: Awk match na `${VAR:-}` pattern může sednout 2× (jednou na
expansion samotnou) → duplicate YAML keys. Vždy `grep -n VAR file`
před a po editaci.

**Soubor**: memory `session_2026_06_01_blacklist_pwa.md` (sekce 4).

### Docker Compose `.env` ≠ automatic inject do kontejneru

**Problém**: VAPID v `.env` na NASce, ale `docker exec app env | grep VAPID`
vrátil nic.

**Příčina**: `.env` slouží pro **variable substitution v compose YAML**,
NE pro automatic inject env vars do kontejneru. Bez explicit řádku
`VAR: ${VAR:-}` v `service.environment:` nebo `env_file: - .env` direktivy
kontejner env var nedostane.

**Řešení 1** (explicit, recommended pro produkční secrety):
```yaml
app:
  environment:
    VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
    VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
    VAPID_SUBJECT: ${VAPID_SUBJECT:-}
```

**Řešení 2** (env_file, jednoduché ale méně transparent):
```yaml
app:
  env_file:
    - .env
```

**Diagnostický postup** (4 kroky):
1. `grep VAR /volume1/docker/<proj>/.env` — hodnota v .env?
2. `grep VAR /volume1/docker/<proj>/docker-compose.yml` — řádek v environment?
3. `docker compose config | grep -i var` — compose resolved hodnotu?
4. `docker exec <container> env | grep VAR` — kontejner vidí?

Když 1✓ 2✗ → přidat do compose
Když 1✓ 2✓ 3✗ → YAML syntax error / duplicate keys
Když 1✓ 2✓ 3✓ 4✗ → recreate kontejneru

**Soubor**: memory `session_2026_06_01_blacklist_pwa.md` (sekce 4).

---

## Frontend / UI

### Calendar fixed-positioning vyžaduje React Portal — PLATÍ PRO VŠECHNY DROPDOWNY

**Problém**: Modaly/tooltipy/dropdowny v komponentě s glass parent
vyletěly daleko od kurzoru, schovaly se za jiné karty, nebo padly dolů.

**Příčina**: Glass utility (`.glass`, `.glass-strong`, `.glass-subtle`)
má `backdrop-filter`, což vytváří **nový containing block** pro
`position: fixed` a nový **stacking context** pro `z-index`. Modal nebo
dropdown uvnitř glass parent je positioned vůči glass kontejneru, ne
vůči viewportu, a jeho z-index funguje jen lokálně.

**Řešení**: Vždy `createPortal(content, document.body)` + `position: fixed`
+ vypočtená pozice z `buttonRef.current.getBoundingClientRect()`:

```tsx
const buttonRef = useRef<HTMLButtonElement>(null);
const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

function handleOpen() {
  const rect = buttonRef.current?.getBoundingClientRect();
  if (rect) {
    setPos({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8)),
    });
  }
  setOpen(true);
}

// V render:
{open && pos && typeof document !== "undefined" && createPortal(
  <>
    <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
    <div className="fixed z-[101] glass-strong rounded-md ..." style={{ top: pos.top, left: pos.left }}>
      ...
    </div>
  </>,
  document.body,
)}
```

Plus:
- Hover delay max **80ms** (nad to UX zlobí)
- z-index **100** backdrop, **101** content
- Clamp `left` aby nevyletěl mimo viewport

**Komponenty kde to bylo aplikováno** (chronologicky):
- Calendar modaly/tooltipy (commit `38ccc62`, 2026-05-05)
- Timeline View multi-select (commit `e117385`, 2026-05-20)
- TaskAudioReview ProjectPicker (commit `c8f6bf2`, 2026-06-09)
- TriageList „Změnit typ" dropdown (commit pending, 2026-06-09)

**Audit checklist před PR**: pokud přidáváš dropdown/popover/modal
uvnitř glass kontejneru, **MUSÍ** jít přes Portal. `position: absolute z-50`
NESTAČÍ.

**Soubor**: `src/components/calendar/*`, `src/components/TaskAudioReview.tsx`
(ProjectPicker), `src/components/TriageList.tsx` (typeMenu). Memory
`feedback_calendar_fixed_positioning.md`.

### Smart routing pravidlo #3 — Team Workspace projekty pro členy

**Problém**: Úkoly přiřazené kontaktu s `isTeam=true` šly do hardcoded
„Práce" / sekce <jméno>, ale Petrův setup je jiný — každý člen týmu má
**vlastní top-level Team Workspace projekt** (např. „Dominik", „Gáťa").

**Příčina**: 2026-05-18 (Cesta B — Todoist Team Workspace) byla
implementace `resolveClientProject` pro klient-* tagy (pravidla #1 a #2),
ale pravidlo #3 (`assignedToContact.isTeam`) zůstalo s původním
`ensureProject(ctx.praceProjectName, ...)`. Hardcoded „Práce" / sekce.

**Řešení**: `resolveTeamMemberProject(userId, contact)` v
`src/lib/todoist-workspace.ts` najde TWS projekt podle:
1. Exact case-insensitive match contact.firstName / displayName / aliases
2. Slug match (diakritika / mezery)
3. Pokud nic → null = fallback na původní pattern

Pravidlo #3 v `resolveRoute()` (`src/lib/task-todoist-push.ts:319`)
zavolá `resolveTeamMemberProject` nejdřív, jen pokud null → hardcoded
fallback (zachová compatibility).

Plus client-side `computeRoutePreview` v `TaskAudioReview.tsx` zrcadlí
logiku (potřebuje seznam todoistProjects z `/api/todoist/projects-list`).

**Lesson**: Když refaktoruju routing, musím projít **VŠECHNA pravidla**,
ne jen ta která se zjevně týkají nové feature. Tabulka pravidel v
memory `feedback_team_workspace_routing_gap.md`.

**Soubor**: `src/lib/task-todoist-push.ts:319-360`,
`src/lib/todoist-workspace.ts:resolveTeamMemberProject`,
`src/components/TaskAudioReview.tsx:computeRoutePreview`.

### Manuální picker projektu — escape hatch pro AI rozhodnutí

**Problém**: Smart routing 6-úrovňový (2026-05-10) byl bez manuálního
overridu. Když AI rozhodla špatně (např. „Dominik zajistit X" →
Moje úkoly), Petr neměl jak override.

**Příčina**: Design choice „ať AI/routing rozhodne, ať Petr nemusí klikat".
Bez fallback UI pro AI chybu.

**Řešení**: Migrace `20260609180000_task_manual_routing` přidává 2 nullable
pole na Task (`manualTodoistProjectId`, `manualTodoistSectionId`). UI
`ProjectPicker` v `TaskAudioReview.tsx` umožňuje kliknout chip 📁 →
dropdown se seznamem Todoist projektů + sekcí → výběr override Smart routing.

`task-todoist-push.ts` skip resolveRoute když `task.manualTodoistProjectId`
set → použij manual hodnotu, `routedHow: "manual override (Triage picker)"`.

**Pravidlo do budoucna**: Pro **každý AI-driven automatický rozhodovací krok**
musí být v UI možnost manuálního overridu. Žádné výjimky. Memory
`feedback_smart_routing_needs_escape.md` má audit list pro ostatní moduly
(`/posta`, `/calendar/invite`, `/notifikace`, `/studna`, `/denik`).

**Soubor**: `src/components/TaskAudioReview.tsx:ProjectPicker`,
`src/pages/api/todoist/projects-list.ts`,
`src/pages/api/ukoly/audio/[batchId]/commit.ts`,
`src/lib/task-todoist-push.ts:486-491`.

### Multi-select dropdown přes Portal (z-index fix)

**Problém**: Dropdown v Timeline View se schoval pod jinou kartu.

**Příčina**: Stejný backdrop-filter stacking context issue.

**Řešení**: Stejný pattern — `createPortal` do `document.body`.

**Soubor**: memory `session_2026_05_20_timeline_view.md`.

### iOS Safari pro Add to Home Screen sahá pro `/apple-touch-icon.png`

**Problém**: PWA ikona změněna v `<link rel="apple-touch-icon" href="/icons/foo.png">`,
ale iOS používal starou.

**Příčina**: iOS Safari **hard-coded** sahá pro `/apple-touch-icon.png`
v root URL bez ohledu na link tag.

**Řešení**:
- Nahradit i root `/public/apple-touch-icon.png` + `/apple-touch-icon-precomposed.png`
- Link tag mít sizes attribute: `<link rel="apple-touch-icon" sizes="180x180" ...>`
- Cache-bust přes manifest `id` + `start_url?v=N` + icon URL `?v=N`

**Soubor**: memory `feedback_ios_pwa_icons.md`.

### iOS 18+ Dark/Tinted home screen auto-tintuje PWA ikony

**Problém**: Orange Gide-on ikona na ploše vypadala černá.

**Příčina**: iOS 18+ má 3 módy pro homescreen (Light/Dark/Tinted). PWA
nemůže dodat dark variantu (Apple limit, jen native apps přes Asset
Catalog). iOS auto-tintuje barvové ikony na tmavé.

**Řešení**: Použít **dark-by-design** ikonu (`icon-ink` variant — tmavé
bg + cream G + orange toggle). iOS auto-tint má pak co tintovat
konzistentně.

**Soubor**: memory `feedback_ios_pwa_icons.md`,
`public/icons/gide-on/apple-touch-icon.png`.

### iOS Springboard cache je notoricky persistentní

**Problém**: Po změně PWA ikony iOS pořád ukazoval starou.

**Příčina**: Springboard má vlastní cache pro homescreen ikony, mimo
Safari Website Data scope.

**Řešení** (postup pro fresh install):
1. Smaž starou ikonu z plochy (long press → Remove App)
2. Settings → Safari → Advanced → Website Data → doména → Smazat
3. **Restart iPhone** (Springboard cache flush)
4. Safari → tvoje URL → Sdílet → Přidat na plochu
5. Nová ikona ✓

Když i tak ne: Settings → General → iPhone Storage → Safari → Offload App + reinstall.

**Soubor**: memory `feedback_ios_pwa_icons.md`.

### astro-icon SSR fail pattern

**Problém**: `<Icon name="lucide:Immich" />` na neexistující sprite ID
**rozbije SSR render** celé stránky.

**Příčina**: astro-icon při render throw error pokud sprite ID neexistuje.
Astro SSR error bubbles nahoru a vyrenderuje 500.

**Řešení**: Pro user-input icon names vždy validovat:
```ts
function safeIconName(name: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return "globe"; // fallback
  return name;
}
```
Nebo wrap v try/catch v render layeru.

**Soubor**: `src/lib/page-links.ts`, memory
`session_2026_05_27_dashboard_feedback.md`.

---

## Backend / DB

### Fire-and-forget Promise GC v Astro/Node

**Problém**: Studna async AI processing tichu mizel — Promise se neřešilo,
DB záznam zůstal v `status: "processing"` navždy.

**Příčina**: Astro/Node GC sebrala Promise reference protože nikdo na ni
nečekal.

**Řešení**: Module-level `Set<InFlight>` drží references:
```ts
const inFlight = new Set<Promise<void>>();
function fireAndForget(p: Promise<void>) {
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
}
```
Plus diagnostic endpoint `/api/diagnose/studna` ukazuje aktuální state.

**Soubor**: `src/lib/process-recording.ts`, memory
`todo_studna_async_still_failing.md`.

### iCloud recurring iterator must jump-forward

**Problém**: RODINA kalendář zmizel — 5 let starý daily event neviděl
aktuální týden.

**Příčina**: `ICAL.js event.iterator()` startuje od `DTSTART`. Pro daily
event 5+ let staré nízký safety limit nikdy nedosáhne aktuálního windowu.

**Řešení**: Vždy jump-forward na `windowStart` + safety ≥ 1000:
```ts
const iterator = event.iterator();
let occurrence = iterator.next();
let safety = 0;
while (occurrence && occurrence.compare(windowStart) < 0 && safety < 1000) {
  occurrence = iterator.next();
  safety++;
}
```

**Pozor**: Jen pro iCloud. Google má `singleEvents=true` (server vrací
flattened occurrences).

**Soubor**: `src/lib/icloud-calendar.ts`, memory
`feedback_icloud_recurring_iterator.md`.

### Apple CardDAV XML — numeric entities + stub kontakty

**Problém**: Po sync kontaktů Petr měl `&#13;` v emailech/telefonech +
prázdné kontakty se `&#13;` jako jméno.

**Příčina**: Apple posílá numeric HTML entities (`&#13;` = `\r`), náš
decoder znal jen pojmenované (`&amp;`/`&lt;`/...).

**Řešení**: Rozšířený decoder (`decodeEntities()` handles `&#NNN;` +
`&#xHH;`) + odmítnutí prázdných vCard v parseru + cleanup endpoint pro
historická data + match přes `phoneKey` (posledních 9 číslic).

**Soubor**: `src/lib/carddav.ts`, memory `feedback_carddav_xml_entities.md`.

### Google Calendar Dovolená/Nomád = DELETE+CREATE (ne PATCH)

**Problém**: Edit all-day Google eventů přes PATCH nezměnil datum.

**Příčina**: Google API ignoruje patch u all-day events u některých field
kombinací.

**Řešení**: DELETE + CREATE místo PATCH.

**Soubor**: `src/lib/google-calendar.ts`, memory
`session_2026_05_20_timeline_view.md`.

### Google Calendar description je plain text

**Problém**: V Google Calendar UI se zobrazil markdown `**bold**` raw.

**Příčina**: Google Calendar `description` field je plain text, ne markdown.

**Řešení**: Při generování invite description **žádný markdown** —
emoji + bullets ASCII + plain URL bez `[text](url)`.

**Soubor**: `src/lib/booking.ts`.

### SQL NULL + Prisma `NOT { field: "..." }` skrývá NULL řádky

**Problém**: Petr viděl 3 invity v listu, ale měl 10 v DB.

**Příčina**: `WHERE NOT field = "x"` v SQL **vynechává NULL řádky** —
NULL ≠ "x" je `UNKNOWN`, ne `TRUE`. Prisma `NOT { field: "x" }`
generuje to stejné.

**Řešení**: Explicit `OR: [{ field: null }, { NOT: { field: "x" } }]`.

**Soubor**: `src/pages/booking/index.astro` 2026-05-27 fix.

### Mobile Safari blokuje `setTimeout(click)` workaround

**Problém**: Audio upload tlačítko na iPhone nefungovalo (file picker se neotevřel).

**Příčina**: Mobile Safari blokuje delayed user-gesture handlers (anti-popup
ochrana). `setTimeout(() => input.click(), 100)` = block.

**Řešení**: Direct hidden file input + `onClick` handler bez setTimeoutu:
```tsx
<input ref={fileRef} type="file" hidden onChange={handleFile} />
<button onClick={() => fileRef.current?.click()}>Nahrát</button>
```

**Soubor**: `src/components/UploadButton.tsx`, memory
`session_2026_05_27_big_day.md`.

### Gemini reasoning si bere output token quótu

**Problém**: AI extract úkolů z 29min audio vrátil jen 5 úkolů (mělo 36).

**Příčina**: Gemini 2.5 Pro thinking mode si bere z output token kvóty
pro reasoning. Při defaultu thinking spotřebovala 80%+ output budget →
finální odpověď byla zkrácená.

**Řešení**:
- Token limit zvedat na 60k (z 12k)
- `thinkingBudget: 4096` (limit reasoning aby neukradl output)
- Plus prompt přepsán „30 min = 40-100+ úkolů" (explicit počet)

**Soubor**: `src/lib/ai-prompts.ts`, memory
`session_2026_05_27_big_day.md`.

### Pošta JSON parse fail — Gemini občas obalí extra text

**Problém**: 49 z 50 emailů hodilo „JSON parse error" v classify pipeline.

**Příčina**: Gemini občas obalí JSON do textu („Here is the analysis: { ... }
That's it.") nebo pošle markdown code fence.

**Řešení**: `extractFirstBalancedObject()` helper najde první balanced
`{...}` (count braces). Plus tolerantní parser akceptuje single quotes
+ trailing commas.

**Soubor**: `src/lib/posta-classify.ts`, memory
`session_2026_05_27_dashboard_feedback.md`.

### Před DB query VŽDY Read `prisma/schema.prisma`

**Problém**: Hádal jsem `userAgent` místo `label` na `WebPushSubscription`,
Petr právem vytkl 2× v jedné session.

**Příčina**: Nehledal jsem skutečný schema — jen jsem si vymyslel název
podle zvyklostí jiných projektů.

**Řešení**: **Před každým `SELECT col FROM "Model"` Read `prisma/schema.prisma`
v sekci modelu**. Sloupce v Postgres = case-sensitive (`"userId"` ne `userid`).

**Soubor**: memory `session_2026_06_01_blacklist_pwa.md` (sekce 4 lesson).

---

## AI / Gemini

### Žádné točící se kolečko v UI

**Problém**: Petr 2026-05-07: spinner u fire-and-forget AI = matoucí
(„můžu odejít?").

**Řešení**:
- Vždy ukázat záznam hned s placeholder
- Polling à 4-5s tichý (`load(false)` pattern, žádný spinner)
- AI doplnění tiché (rozdíl je v `status` field z processing → done)
- Spinner OK jen u krátkých foreground operací (upload bytes, login, search)

**Soubor**: memory `feedback_no_processing_spinner.md`.

### Před změnou AI prompt/JSON shape Read celý generator

**Problém**: Custom AI prompt v projektech rozbil JSON contract — Stage 2
expected `{tasks: [...]}` ale custom prompt vrátil `{ tasks: ..., extras: ... }`.

**Řešení**: Před změnou Read **celý** generator soubor + downstream
consumers. Custom prompty oddělit do separátního field (`customExtract`
volný markdown, ne strukturovaný JSON).

**Soubor**: memory `feedback_grep_before_code.md`.

### FFmpeg `lowpass=3000` dusil řeč

**Problém**: Audio cleanup před transkriptem zfiltroval moc hlasu.

**Příčina**: `lowpass=3000` = 3kHz cutoff. Lidská řeč má energii do 8kHz+
(zejména souhlásky). Gemini transkript byl trash.

**Řešení**: `lowpass=8000` (8kHz cutoff) + před změnou audio filtru
**ověřit s teorií** (Nyquist, formanty).

**Soubor**: `src/lib/audio-clean.ts`, memory `feedback_grep_before_code.md`.

---

## Push notifikace

### VAPID rotation kill all subscriptions

**Problém**: Petr přepsal staré VAPID klíče za nové → staré subscriptions
přestaly fungovat.

**Příčina**: Web Push protokol váže endpoint na konkrétní VAPID public key.
Nový private key vytvoří podpisy neplatné pro staré endpointy → Apple/Google
gateway vrátí 410/404.

**Řešení**:
- `sendPushToUser()` na 410/404 automaticky smaže subscription z DB
- Petr musí re-Povolit push na všech zařízeních
- **VAPID je one-time setup** — neměnit dokud nejsou skutečné security důvody

**Soubor**: `src/lib/webpush.ts`, memory
`session_2026_06_01_blacklist_pwa.md` (sekce 3).

### iOS push vyžaduje PWA mode + iOS 16.4+

**Problém**: Push notifikace nefungovaly v Safari na iPhone.

**Příčina**: iOS jen v PWA mode (Add to Home Screen) povolí Web Push.
iOS 16.4+ je minimum.

**Řešení**: Petr musí na iPhonu:
1. Safari → `/start` → Sdílet → Přidat na plochu
2. Otevřít PWA z plochy (ne ze Safari!)
3. `/settings/push` → Povolit push
4. iOS request permission dialog → Allow

**Soubor**: memory `session_2026_05_27_dashboard_feedback.md`.

### Dead code check — feature existuje ale nikdo ji nevolá

**Problém**: Petr 2026-05-27 nahlásil že push nepřišly. Audit:
`src/lib/webpush.ts` + `public/sw.js` + `/api/push/subscribe` +
`PushSettings.tsx` + `WebPushSubscription` model VŠECHNO hotové,
ale `sendPushToUser()` měl **0 call sites** v aplikaci.

**Lesson**: Pro velký existing kód vždy `grep <function_name>` zjistit
zda něco volá. Feature může být „hotová" ale dead code.

**Soubor**: memory `session_2026_05_27_dashboard_feedback.md`.

---

## Style work

### Grep před psaním kódu — nevymýšlet názvy

**Problém**: `prisma.studnaProject` neexistuje (model je `projectBox`).
2× v jedné session.

**Lesson**:
- Před API endpointem `grep "prisma\."` v sousedních endpointech
- Před změnou AI prompt/JSON shape Read celý generator soubor
- Před domain filtrem ověřit s teorií (DNS RFC, Nyquist, atd.)

**Soubor**: memory `feedback_grep_before_code.md`.

### Velké feature dávky v jednom commitu

**Problém**: Cesta B rozsekána na 5 commitů → 5× deploy overhead = hodina.

**Lesson**: Velká feature v jednom commitu. Diagnostické endpointy
s `?action` param (no side effects default). Rate-limit volání 3rd party API.

**Soubor**: memory `feedback_one_dose_vs_iterations.md`.

### Worktree commits propagovat do main pro GitHub Desktop

**Problém**: Petr nevidi commity v GH Desktop pokud zůstanou na worktree branch.

**Lesson**: Po každém commitu ve `.claude/worktrees/<name>` udělat
`git -C <main-repo> merge --ff-only claude/<branch>` aby Petr commity
viděl v GH Desktop a mohl pushnout.

**Soubor**: memory `feedback_worktree_propagate_to_main.md`.

### Completeness — „je to dost nedotažený"

**Problém**: Petr 2026-05-13 ke 5 skulinám (diego/NAS pletení, DSM cron
rada mimo, scope readonly místo modify, chybějící karta Google na hlavní
integrations, chybějící reauth banner).

**Pravidla**:
- Před radou grep/Read existujícího kódu
- Memory není dekorace — číst aktivně
- Deploy hygiena = UI musí být objevitelná
- „Nedotaženo" = chybí posledních 20% UX
- Přiznat rovně co nevím

**Soubor**: memory `feedback_completeness_lesson.md`.

### Audit pattern — po session vždy projít TS + grep newly added kód

**Problém**: Petr 2026-05-27: „pečlivě si projdi co máme a hledej chyby" →
3 reálné bugy nalezeny.

**Lesson**: I pro „malé" commity spustit `npx tsc --noEmit` + projít changes:
- Multi-user leak v processTaskAudio (params.userId neexistujícího v interface)
- InlineTitle race condition (useEffect přepisoval mid-edit draft)
- cron-schedule TS type union too narrow

**Soubor**: memory `session_2026_05_27_dashboard_feedback.md`.

---

## Smart Routing (Task → Todoist)

### 6-úrovňový routing s audit logem

**Pořadí fallback**:
1. **klient-tag** — Task má `clientSlug` tag → Project = `clientSlug` v Todoist
2. **klient-kontakt** — Task má @kontakt, kontakt má `clientTag` → použij
3. **tým** — Task má @kontakt, kontakt má `isTeam=true` → tým projekt
4. **lidé** — Task má @kontakt → Lidé sekce v default projektu
5. **personal-tag** — Task má jiný tag → odpovídající sekce
6. **fallback** — Inbox

### t-* tagy filtrované z routing logiky

**Problém**: `t-30m`, `t-1h` atd. jsou time estimate, ne routing tag.
Pokud by je routing použil, vytvořilo by to projekty „t-30m" v Todoist.

**Řešení**: V `task-todoist-push.ts` filter `tag.startsWith("t-")` a `=== "t-?"`
před routing pass.

### Žádné halucinace slugu — distinct list z DB

**Problém**: AI prompt občas vymyslel slug který neexistuje.

**Řešení**: AI prompt **MUSÍ mít distinct seznam clientSlugs z DB** +
explicit „zákaz fuzzy úprav". Plus `RoutingAuditLog.aiResponse` raw output
pro forensic.

**Soubor**: `src/lib/task-todoist-push.ts`, `INSTRUKCE/SMART-ROUTING.md`,
memory `feedback_smart_routing.md`.

---

## Cron

### NEpřidávat úlohy do DSM Task Scheduleru

**Pattern**: DSM volá **jen jeden endpoint** — `/api/cron/scheduler`.
Ten si dispatchuje vše dle `CRON_JOBS` pole v `src/lib/cron-schedule.ts`.

Pro novou cron úlohu:
1. Endpoint v `src/pages/api/cron/<jmeno>.ts`
2. Záznam do `CRON_JOBS` s `cronExpression` (5-segment)
3. **ŽÁDNÉ DSM změny**

**Soubor**: memory `feedback_cron_dispatcher_pattern.md`.

---

## Email Intelligence (Pošta)

### GCP gotcha — Gmail API enable

**Problém**: Po reauth OAuth scope `gmail.modify` první call vrátí
„Gmail API has not been used in project ... before or it is disabled".

**Řešení**: GCP Console → APIs & Services → Library → Gmail API → Enable.

**Lesson**: **OAuth scope ≠ enabled API**. Scope = browser asks for
permission, ale API musí být enabled v projektu.

**Soubor**: `docs/email-intelligence/INFRASTRUCTURE.md`, memory
`feedback_gcp_gmail_api_enable.md`.

### Pošta scope = `gmail.modify + gmail.send` (ne jen readonly)

**Problém**: Po nasazení Pošta nic neimportovala.

**Příčina**: F1 implementovala jen `gmail.readonly + gmail.metadata`,
nepřinesla scope „označit jako přečtené" (modify) ani „odpovědět" (send).

**Řešení**: Scope rozšířen na `gmail.modify + gmail.send` (commit `28fd888`).
Reauth banner v `/settings/integrations/google` (commit `3fe1f8f`).

**Soubor**: memory `project_posta_module.md`.

---

## Audio

### Audio retention pravidla — kompletní matice

| Type | Default lifespan | Smaže se? |
|------|------------------|-----------|
| STANDARD | 14 dní | Ano (cron-cleanup-audio 03:00) POKUD: ne-Prskavka, ne-pinned, host bez keepAudio |
| Prskavka | Trvale | Ne (vždy zachovat) |
| BRIEFy | Trvale | Ne |
| `isPinned=true` | Trvale | Ne |
| `keepAudio=true` (per-host) | Trvale | Ne |
| UPLOAD type | Trvale | Ne (host nahrál hotové audio) |

Transkripty + analýza **zůstávají vždy**.

**Soubor**: `src/lib/cleanup-audio.ts`, memory `project_audio_retention_rules.md`.

---

## File header

Pokud při řešení něčeho narazíš na netriviální problém co
trvalo > 30 min: **přidat sem v stylu výše**.

Plus mrkni do memory souborů (`~/.claude/projects/.../memory/`) — tam
jsou další pasti které sem ještě nebyly synthesizovány.
