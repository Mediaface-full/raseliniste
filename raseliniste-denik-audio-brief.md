# Rašeliniště — Deník přes diktafon (audio brief)

> Verze: draft 1 · 2026-04-28
> Autor: Petr (zadání) → Claude (sepsání)
> Související: `HANDBOOK.md` (modul Deník), `src/lib/audio-transcribe.ts`, `src/lib/process-recording.ts`, `raseliniste-kalendar-brief.md` (vzor)

## 1. Proč

Deník dnes funguje jen jako **textový vstup** (`/denik/new` → AI redaktor přepíše do Petrova hlasu). Petr ale nejvíc reflektuje ve volných minutách — autem, na procházce, ve vlaku — kde nemůže psát. Potřebuje **diktafon** stejně přirozený jako ve Studně, ale směrovaný do svého soukromého deníku, ne do projektu.

Cíl: Petr stiskne mikrofon, mluví 30 s – 30 min volně (proud myšlenek, "co se dnes stalo", "co mě štve"), nahrávka se na pozadí přepíše a AI z toho udělá **strukturovaný deníkový zápis** — beze ztráty Petrova hlasu, bez vaty, s rozpoznáním nálady a tagů.

## 2. UX flow

### 2.1 Vstupní místa

1. **`/denik` — hlavní stránka deníku**
   - Velké tlačítko `Mic` nahoře ("Nadiktovat zápis"), pod ním kalendář / list zápisů.
   - Pod tlačítkem dropdown: dnes / včera / vlastní datum (default = dnes).
2. **Globální Quick capture** (`/quickadd` nebo Siri Shortcut)
   - Pokud Petr řekne "deník: …" → stejný flow, jen už ví, že to jde do deníku.
3. **iOS Siri Shortcut** (phase 2) — "Hej Siri, nový zápis do deníku" → otevře `/denik/audio?date=today`.

### 2.2 Recorder UI

Reuse **`OwnerRecorder`** komponenty ze Studny, ale s vlastními parametry:

- **STANDARD limit:** 15 min (deník bývá delší než pracovní záznam, ale ne 90).
- **BRIEF mode:** upload souboru (audio z Plaud Note, WhatsApp voice z auta, …), limit 60 min.
- Po stop → fáze `uploading` → polling status → `done` ukáže preview a tlačítko "Otevřít zápis".
- **Žádné metadata pole před nahráváním** — Petr má mluvit, ne klikat. Datum se přebere z URL nebo z timestampu nahrávky.

### 2.3 Po zpracování

Otevře se **draft view** `/denik/[id]/edit`:
- Nahoře: AI strukturovaný zápis (markdown, sekce viz §4).
- Sklápěcí blok: surový transkript (read-only).
- Sklápěcí blok: audio přehrávač.
- Tlačítka: **Uložit jako finální** · **Smazat audio (ponechat text)** · **Přepsat AI** (re-run s případně upraveným promptem) · **Smazat celý zápis**.
- Default po uložení: audio se **smaže** po 7 dnech (cron, viz §6). Petr může v zápisu zaškrtnout "Ponechat audio navždy".

## 3. Datový model

Rozšířit existující `JournalEntry` (předpokládáme, že existuje) nebo přidat novou entitu, pokud deník zatím nemá schema:

```prisma
model JournalEntry {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  date          DateTime @db.Date          // datum, ke kterému zápis patří
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Obsah
  title         String?                    // AI vygenerovaný 1-řádkový titulek
  bodyMarkdown  String   @db.Text          // finální verze (po AI strukturování)
  rawTranscript String?  @db.Text          // syrový přepis z audio (null = textový vstup)
  mood          JournalMood?               // AI klasifikace, viz enum
  tags          String[]                   // AI extrahované, např. ["práce", "rodina", "spánek"]
  highlights    String[]                   // 1–3 bullet points "co bylo důležité"

  // Audio metadata
  audioPath     String?                    // relative path v uploads/, null pokud čistě textový
  audioMime     String?
  audioBytes    Int?
  audioDurationSec Int?
  audioRetainForever Boolean @default(false) // jinak se po 7 dnech maže
  audioDeletedAt DateTime?

  // Zpracování
  status        JournalStatus @default(draft)   // draft|processing|ready|error
  processingError String? @db.Text

  @@index([userId, date])
  @@index([status])
}

enum JournalMood {
  ELATED       // nadšený, povznesený
  CONTENT      // v pohodě
  NEUTRAL      // neutrální
  TIRED        // unavený
  STRESSED     // ve stresu
  DOWN         // smutný, rezignovaný
  ANGRY        // naštvaný
  MIXED        // smíšené pocity
}

enum JournalStatus {
  draft
  processing
  ready
  error
}
```

**Migrace:** pokud `JournalEntry` ještě neexistuje, přidat celou. Pokud existuje s jednodušším schema — rozšířit a backfill.

## 4. AI zpracování

Stejný pattern jako `processRecording` ze Studny, jen s jiným systémovým promptem.

### 4.1 Pipeline

`src/lib/process-journal-audio.ts` (nová):

```ts
export async function processJournalAudio({
  entryId, audio, mimeType
}: { entryId: string; audio: Buffer; mimeType: string }) {
  // 1) update status = processing
  // 2) transcribe (audio-transcribe.ts, Gemini Flash, low temp)
  // 3) structureJournalEntry(transcript) → Pro model
  // 4) update entry { rawTranscript, bodyMarkdown, title, mood, tags, highlights, status: ready }
  // 5) on error: status=error, processingError
}
```

### 4.2 Prompt pro strukturování (Vertex Gemini Pro)

**Systémová instrukce:**

> Jsi asistent Petra Periny pro vedení osobního deníku. Petr ti dá **přepis volně namluveného deníkového záznamu**. Tvým úkolem je z toho vyrobit **strukturovaný zápis v Petrově hlasu** — věcný, krátký, bez literárních ozdob, bez vaty.
>
> **Pravidla:**
> 1. **Zachovej Petrův styl:** krátké věty, čeština, "ukolíbej" se neopravuje na "ukolébej" pokud je to záměrný výraz, neformální tón, občasná vulgarita ano (necenzuruj).
> 2. **Neměň fakta:** pokud Petr řekne "v úterý jsem byl u doktora", napiš to. Nevymýšlej souvislosti, neinterpretuj nálady, nesnaž se ho povzbudit ani komentovat.
> 3. **Odstraň výplň:** "no a" / "takže" / "víš co" / opakování / koktání / falešné starty.
> 4. **Strukturuj do sekcí jen pokud to dává smysl:** pokud zápis pokrývá víc témat, použij `## ` nadpisy (např. "## Práce", "## Rodina", "## Zdraví"). Pokud je to jeden tok myšlenek, nech to bez nadpisů.
> 5. **Highlights:** vyber 1–3 nejdůležitější body (rozhodnutí, události, pocity) — krátké bulleti, max 80 znaků každý.
> 6. **Mood:** klasifikuj jednou hodnotou z enum (viz níže). Při smíšených pocitech použij MIXED.
> 7. **Tags:** 2–6 tagů malými písmeny, česky, bez diakritiky-háčků (např. "prace", "rodina", "spanek", "zdravi", "blanka", "mortyk"). Nepřekládej jména.
> 8. **Title:** 1 věta, max 60 znaků, věcná. Ne clickbait, ne otázka. Např. "Únavný den po hokeji, večer s Blankou".
>
> Vrať **přesně** tento JSON (žádný markdown wrapper):
> ```json
> {
>   "title": "...",
>   "bodyMarkdown": "...",
>   "mood": "CONTENT",
>   "tags": ["..."],
>   "highlights": ["...", "..."]
> }
> ```

**User message:** přepis transkriptu doslova.

**Model:** `gemini-2.5-pro` (kvalita > rychlost — deník není time-critical).
**Temperature:** 0.4 (chceme konzistenci, ale ne robotickou suchost).
**MaxOutputTokens:** 8000 (dlouhé zápisy).

### 4.3 Validace odpovědi

Zod schema pro odpověď, retry 1× pokud parse fail. Pokud i druhý pokus selže → uložit jen `rawTranscript` a `bodyMarkdown = rawTranscript`, `status: ready`, `processingError: "AI strukturování selhalo"`. Petr to pak může re-runnout ručně.

## 5. API endpointy

```
POST  /api/denik/audio
      multipart: audio (File), date? (YYYY-MM-DD), durationSec?
      → { entryId, status: "processing" }

GET   /api/denik/[id]
      → { entry: {...} } (pro polling)

POST  /api/denik/[id]/regenerate
      → re-run AI strukturování ze stávajícího rawTranscript

PATCH /api/denik/[id]
      body: { title?, bodyMarkdown?, mood?, tags?, highlights?, audioRetainForever? }
      → ručně upravený zápis

DELETE /api/denik/[id]/audio
      → smaže jen audio soubor, zápis ponechá

DELETE /api/denik/[id]
      → smaže celý zápis i audio
```

Všechny chráněné session middlewarem, single-user (Petr).

## 6. Audio retention

Cron task `cleanupJournalAudio` denně v 03:00:
- Najde `JournalEntry` kde `audioPath != null AND audioRetainForever = false AND createdAt < now() - 7 days`.
- Smaže soubor z disku, vynuluje `audioPath/audioMime/audioBytes`, nastaví `audioDeletedAt`.

UI v zápisu ukazuje: *"Audio se smaže za 4 dny. [Ponechat navždy]"*

## 7. Co NEDĚLAT (anti-features)

- **Žádný sentiment scoring v procentech / grafy nálad.** Petr není data point.
- **Žádné automatické "doporučení"** ("Zkus si zacvičit, máš to v zápisech často"). Deník je výpověď, ne coach.
- **Žádné public sharing** / export do social. Tohle je nejintimnější modul.
- **Žádný full-text indexing přes Gemini embedding** v phase 1. Až Petr bude mít 100+ zápisů, řešíme zvlášť.
- **Žádné editování transkriptu před AI runem.** Buď to AI zvládne, nebo to Petr přepíše ručně po AI runu.

## 8. Fáze

- **Phase 1 (MVP):** Schema, recorder na `/denik`, processJournalAudio, draft view, manual edit. (~3–5 dní práce)
- **Phase 2:** Siri Shortcut "Nový zápis do deníku" + Quick capture rozpoznávání "deník: …".
- **Phase 3:** Týdenní/měsíční rekapitulace (Pro model dostane všechny zápisy z období → vrátí 1-stránkový souhrn). Pull-only, na vyžádání.
- **Phase 4:** Připojení k briefingu (HANDOFF.md §Briefing 22:00) — pokud Petr má dnes deníkový zápis, briefing ho zmíní v sekci "Co se dělo".

## 9. Otevřené otázky

1. **Co když Petr nadiktuje záznam k jinému datu** ("…tak vlastně tohle bylo ve čtvrtek")? → AI by to mohla detekovat a navrhnout jiné `date`. Pro MVP: ignorovat, datum = den nahrávky.
2. **Co když je deníkových záznamů víc za den?** → MVP: povolit. Každý jako samostatný `JournalEntry` se stejným `date`. UI je seřadí podle `createdAt`.
3. **Heslo / 2nd factor pro deník?** → Až později, samostatné rozhodnutí. MVP: stejná session jako zbytek systému.
