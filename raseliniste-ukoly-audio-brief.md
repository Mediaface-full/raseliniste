# Rašeliniště — Úkoly přes diktafon (audio brief)

> Verze: draft 1 · 2026-04-28
> Autor: Petr (zadání) → Claude (sepsání)
> Související: `HANDBOOK.md` (modul Úkoly), `raseliniste-denik-audio-brief.md`, `src/lib/audio-transcribe.ts`, `src/lib/process-recording.ts`

## 1. Proč

Petr nejvíc vymýšlí úkoly **mimo počítač** — v autě, na obchůzce, při procházce. Dnes mu je musí buď psát do telefonu (otravné, krátké), nebo si je pamatovat (nebezpečné). Potřebuje **diktafon, který z mluvené salvy vyrobí list úkolů** a uloží je do správného modulu.

Cíl: Petr stiskne mikrofon, řekne *"Zítra zavolat Honzovi kvůli střeše, do pátku poslat fakturu Wonderhood, někdy příští týden domluvit servis na auto, a ještě koupit Mortykovi krmení"* — systém mu z toho udělá **4 oddělené úkoly** s odhadnutým termínem, kontextem a tagy.

## 2. UX flow

### 2.1 Vstupní místa

1. **`/ukoly` — hlavní stránka úkolů**
   - Vedle "Nový úkol" tlačítka mikrofon "Nadiktovat úkoly".
2. **`/quickadd`** — sekundárně, pokud Petr neví kam dříve.
3. **iOS Siri Shortcut** (phase 2): "Hej Siri, nový úkol" → `/ukoly/audio`.

### 2.2 Recorder UI

Reuse `OwnerRecorder`, ale s parametry:
- **STANDARD limit:** 3 min (úkolová salva by neměla trvat déle).
- **BRIEF mode:** ne (úkoly = krátký vstup, dlouhé audio nedává smysl).
- Po stop → uploading → polling → **review obrazovka** (viz §2.3).

### 2.3 Review obrazovka po zpracování

**Kritické:** AI úkoly jsou **návrh, ne fait accompli**. Petr musí vidět seznam **před uložením** a zaškrtnout, co se má vytvořit.

UI: `/ukoly/audio/[batchId]/review`

```
┌─────────────────────────────────────────────────┐
│ Nadiktoval jsi 4 úkoly · 1m12s                  │
│ [Přehrát audio ▶] [Surový přepis ▾]            │
└─────────────────────────────────────────────────┘

[✓] Zavolat Honzovi kvůli střeše
    Termín: zítra (29.4.) · Tag: dům, telefonát
    [upravit]                       [smazat]

[✓] Poslat fakturu Wonderhood
    Termín: do pátku (2.5.) · Tag: práce, fakturace
    [upravit]                       [smazat]

[✓] Domluvit servis na auto
    Termín: příští týden (cca 5.5.) · Tag: auto
    [upravit]                       [smazat]

[✓] Koupit Mortykovi krmení
    Termín: žádný · Tag: nákup, mortyk
    [upravit]                       [smazat]

           [Vytvořit zaškrtnuté (4)]  [Zahodit vše]
```

- Default: všechny zaškrtnuté.
- "Upravit" → inline edit title / dueAt / tags / notes.
- "Vytvořit zaškrtnuté" → POST batch, vznikne N `Task` entries, audio se smaže (nebo zachová podle settings).

### 2.4 Po vytvoření

Redirect na `/ukoly` s top bannerem "✓ Vytvořeno 4 úkoly z diktátu".

## 3. Datový model

Předpokládáme existenci `Task` modelu. Pokud neexistuje plnohodnotně, definovat:

```prisma
model Task {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  title       String
  notes       String?  @db.Text
  dueAt       DateTime?
  dueIsTime   Boolean  @default(false)   // true = včetně času, false = jen datum
  tags        String[]
  status      TaskStatus @default(open)  // open|done|cancelled
  priority    TaskPriority @default(normal) // low|normal|high
  createdAt   DateTime @default(now())
  completedAt DateTime?
  source      TaskSource @default(manual) // manual|audio|quickadd|capture
  sourceBatchId String?                  // pro audio batch
  rawSnippet  String?                    // úryvek transkriptu, ze kterého úkol vznikl
  externalId  String?                    // pro budoucí Todoist sync
  externalProvider String?               // "todoist" | null

  @@index([userId, status, dueAt])
  @@index([sourceBatchId])
}

enum TaskStatus {
  open
  done
  cancelled
}

enum TaskPriority {
  low
  normal
  high
}

enum TaskSource {
  manual
  audio
  quickadd
  capture
}

model TaskAudioBatch {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  audioPath       String?
  audioMime       String?
  audioBytes      Int?
  audioDurationSec Int?
  rawTranscript   String?  @db.Text
  status          TaskBatchStatus @default(processing) // processing|review|committed|discarded|error
  proposalsJson   Json?    // [{ title, dueAt, tags, notes, rawSnippet }]
  processingError String?  @db.Text
  createdAt       DateTime @default(now())
  reviewedAt      DateTime?

  @@index([userId, status])
}

enum TaskBatchStatus {
  processing
  review
  committed
  discarded
  error
}
```

`TaskAudioBatch` drží návrh úkolů **dokud Petr nestiskne "Vytvořit"**. Pak se z proposals udělají `Task` entries (s `sourceBatchId`) a batch má `status: committed`.

## 4. AI zpracování

`src/lib/process-task-audio.ts`:

```ts
export async function processTaskAudio({
  batchId, audio, mimeType
}: { batchId: string; audio: Buffer; mimeType: string }) {
  // 1) status = processing
  // 2) transcribe → rawTranscript (Gemini Flash)
  // 3) extractTaskProposals(rawTranscript) → Pro model, JSON
  // 4) save proposalsJson, status = review
  // 5) on error: status = error, processingError
}
```

### 4.1 Prompt pro extrakci úkolů (Vertex Gemini Pro)

**Systémová instrukce:**

> Jsi asistent Petra Periny pro správu úkolů. Petr ti dá **přepis krátké mluvené salvy úkolů** (typicky 30 s – 2 min). Tvým úkolem je z toho vyrobit **seznam jednotlivých úkolů** ve strukturovaném JSONu.
>
> **Pravidla:**
>
> 1. **Jeden záměr = jeden úkol.** "Zavolat Honzovi a poslat mu mail" → 2 úkoly. "Zavolat Honzovi kvůli střeše" → 1 úkol.
> 2. **Title** = imperativ, krátký (max 80 znaků), česky, věcný. Začni slovesem ("Zavolat...", "Poslat...", "Koupit...", "Domluvit..."). Žádná tečka na konci.
> 3. **Termín (`dueAt`)** — parsuj relativní výrazy vůči `referenceDate` (předáno v promptu jako "dnes je YYYY-MM-DD"):
>    - "dnes" → dnešní datum, čas null
>    - "zítra" → +1 den
>    - "pozítří" → +2 dny
>    - "v pondělí" / "v úterý" / … → nejbližší budoucí výskyt toho dne
>    - "do pátku" / "do konce týdne" → nejbližší pátek / neděle, dueIsTime=false
>    - "příští týden" → následující pondělí, jako orientační datum
>    - "v 15:00" / "ve tři odpoledne" → dueIsTime=true, čas dopočítej
>    - "někdy" / "časem" / bez zmínky → dueAt = null
>    - **Nehádej, pokud není zmínka.** Lepší null než falešný termín.
> 4. **Tagy** — 1–4 tagy malými písmeny, bez diakritiky-háčků. Použij jeden z těchto pokud dává smysl: `prace`, `dum`, `auto`, `zdravi`, `rodina`, `mortyk`, `blanka`, `nakup`, `telefonat`, `email`, `fakturace`, `urad`. Volně přidej další pokud potřeba.
> 5. **Priority** — defaultně `normal`. `high` jen pokud Petr explicitně řekl "důležité" / "urgent" / "rychle". `low` jen pokud Petr řekl "kdykoliv" / "není to spěch".
> 6. **Notes** — pokud Petr řekl kontext nebo upřesnění ("…protože jsme se nedohodli minulý týden"), vlož tam. Jinak null. Max 200 znaků.
> 7. **rawSnippet** — doslovný úryvek z přepisu (5–15 slov), ze kterého úkol vznikl. Pomáhá Petrovi v review obrazovce ověřit AI.
> 8. **Pořadí** = pořadí, v jakém Petr úkoly zmínil.
>
> Vrať **přesně** tento JSON (žádný markdown wrapper):
> ```json
> {
>   "tasks": [
>     {
>       "title": "...",
>       "dueAt": "2026-04-29" | "2026-04-29T15:00:00" | null,
>       "dueIsTime": false,
>       "tags": ["..."],
>       "priority": "normal",
>       "notes": null,
>       "rawSnippet": "..."
>     }
>   ]
> }
> ```
>
> Pokud přepis neobsahuje žádný úkol (Petr se přeřekl, nahrál ticho), vrať `{"tasks": []}`.

**User message:** `referenceDate: 2026-04-28 (úterý)\n\nPřepis:\n{transcript}`

**Model:** `gemini-2.5-pro` (potřebuje rozumět češtině + relativním datům dobře).
**Temperature:** 0.2 (konzistentní extrakce).
**MaxOutputTokens:** 4000.

### 4.2 Validace

Zod schema pro response. Pokud parse fail → retry 1×. Pokud i druhý fail → `status: error`, Petr může z review obrazovky kliknout "Zkusit znovu".

## 5. API endpointy

```
POST  /api/ukoly/audio
      multipart: audio (File), durationSec?
      → { batchId, status: "processing" }

GET   /api/ukoly/audio/[batchId]
      → { batch: { status, proposalsJson, rawTranscript, ... } }
        (pro polling z review UI)

POST  /api/ukoly/audio/[batchId]/regenerate
      → re-run extrakce z existujícího rawTranscript

POST  /api/ukoly/audio/[batchId]/commit
      body: { proposals: [{ title, dueAt, dueIsTime, tags, priority, notes, rawSnippet }] }
              (Petrem upravený seznam — jen ty, co chce skutečně vytvořit)
      → { createdTaskIds: [...], batchStatus: "committed" }

POST  /api/ukoly/audio/[batchId]/discard
      → batchStatus: "discarded", smazat audio
```

## 6. Audio retention

- **Při commit:** audio se mažou hned (úkoly jsou vytvořené, audio už není potřeba). Ponechat jen `rawTranscript` v batchi pro audit.
- **Při discard:** audio i transkript se mažou.
- **Batch retention:** committed/discarded batche se mažou po 30 dnech (cron).

## 7. Todoist integrace (phase 3, navazuje na "Co vzít s sebou" docx)

`raseliniste-podklad-co-vzit-s-sebou.docx` (vytvořeno dříve) navrhuje briefing s úkoly. Tady navazujeme:

- **One-way push do Todoist** (Petr je v Todoist nativně) — když se vytvoří `Task` přes audio → push přes Todoist API → uložit `externalId`.
- **One-way pull z Todoist** (zatím out-of-scope, řeší se v "Co vzít s sebou" briefu).
- **Settings:** `/settings/integrations/todoist` — connect přes API token, vybrat default project.

Phase 3, ne MVP.

## 8. Co NEDĚLAT

- **Žádné AI rozhodování o priority bez explicitní zmínky.** Default `normal`. Petr nechce, aby mu AI řekla, že volání mámě je "low priority".
- **Žádný auto-commit** — proposals VŽDY čekají na review. Halucinace v úkolech = horší než ztráta úkolu.
- **Žádné slučování s existujícími úkoly** ("Zdá se, že tohle už máš jako úkol z minulého týdne") v MVP. Možná phase 3.
- **Žádné kalendářové eventy z úkolů** — i když Petr řekne "zítra v 15:00 zavolat Honzovi", vznikne `Task` s `dueAt`, ne `CalendarEvent`. Booking flow je samostatný.
- **Žádné dependency mezi úkoly** ("nejdřív X pak Y") v MVP.

## 9. Fáze

- **Phase 1 (MVP):** Schema, recorder na `/ukoly`, processTaskAudio, review UI, commit. (~3–5 dní práce)
- **Phase 2:** Siri Shortcut + rozpoznávání "úkol: …" v `/quickadd`.
- **Phase 3:** Todoist push integrace (navazuje na briefing brief).
- **Phase 4:** Smart suggestions ("podobný úkol jsi měl 12.3., dořešen?") — opt-in.

## 10. Otevřené otázky

1. **Co když Petr v jedné větě řekne kontext relevantní pro víc úkolů?** ("U Honzy potřebuju vyřešit střechu, taxi, a ještě tu fakturu") → AI by měla **vytvořit 3 úkoly se sdíleným kontextem** v notes nebo tagu. Prompt by mohl explicitně instruovat tagy `honza` jako adresát.
2. **Recurring úkoly** ("každý pátek poslat report") → MVP: vytvoří se jen jeden úkol s nejbližším datem. Recurring až phase 4 (řeší to Todoist nativně, takže možná stačí).
3. **Co když Petr řekne "smaž ten úkol o střeše"?** → Out-of-scope, hlasové ovládání = phase 5+.
