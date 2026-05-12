# Pošta — design decisions pro fáze 2-6

> Závazná specifikace odsouhlasená 2026-05-12. Petrovy odpovědi na 3 otázky
> z `POSTA-PHASE-1.md`. **Při implementaci fází 2+ se ŘÍDIT TÍMTO
> DOKUMENTEM, ne tím, co napíše Claude v session bez kontextu.**

---

## 1. Klasifikace — ortogonalita namísto jedné taxonomie

**Princip:** oddělit *co s tím dělat* (akce) vs *co to je* (obsah). Klient
může poslat newsletter, klient může poslat eskalaci — `category=klient`
nestačí jako rozhodovací signál pro digest.

### Cílové schéma `EmailClassification`

```ts
model EmailClassification {
  id              String   @id @default(cuid())
  messageId       String   @unique
  message         EmailMessage @relation(...)

  // CO S TÍM DĚLAT
  actionType      String   // action_required | waiting_external |
                           // informational | noise
  urgency         String   // low | medium | high
  suggestedAction String?  // LLM návrh — "odpovědět dnes do 18h",
                           // "archivovat", "schválit fakturu", "delegovat"
  escalation      Boolean  @default(false)
                           // true = vícekrát ten samý člověk bez odpovědi
                           //   + zvýšené afektivní markery v textu

  // CO TO JE
  contentType     String   // klient | osobni | admin | newsletter |
                           // reklama | systemovy | bezpecnostni | spam

  // KONTEXT
  projectHint     String?  // volný odhad projektu/tématu, pro
                           // pozdější clusterování
  reason          String   // 1 věta odůvodnění (pro debug + digest)

  model           String
  confidence      Float    // 0-1
  classifiedAt    DateTime @default(now())
}
```

### Důležité

- **NE** přidávat samostatný `needsAction: Boolean` — je redundantní
  s `actionType == "action_required"` a sváděl by k tomu používat ho
  místo `actionType` a ztratit jemné rozlišení mezi *„čeká na mě"*
  a *„čeká na druhou stranu"* (oba neaktivní z Petrovy strany, ale
  jinak významný kontext).

### Použití klasifikace v dotazech

| Use case | Filter |
|---|---|
| Digest „dnes vyřídit" | `actionType = "action_required"` |
| Archivace newsletterů | `contentType = "newsletter"` |
| Eskalace alert | `escalation = true OR urgency = "high"` |
| Klientský přehled | `contentType = "klient"` |
| „Co čeká na druhé" | `actionType = "waiting_external"` |

**Komplexita 7 polí vyplatí precision při filtrování. Nemísit dimenze.**

---

## 2. RAG — hybrid s thresholdem

**Princip:** per-email vs per-chunk je false dichotomy. Cesta je
**hybrid podle délky + thread-awareness**.

### Pravidla chunkování

| Vstup | Strategie |
|---|---|
| Krátký mail (< 500 tokenů) | 1 embedding na celý mail |
| Dlouhý mail | Split na chunky po větných hranicích, target 400-500 tokenů, **soft cap** (nemusí být přesný) |
| Vlákno (thread) | Každá zpráva ve vlákně = vlastní chunk (i krátká), protože reply patří jinému autorovi a jinému času = semanticky odlišný kontext |

### Schema rozšíření `RagChunk`

Reuse existující `RagChunk` model. Pro Poštu přidat metadata:

```ts
// RagChunk dostane:
sourceType    String  // "email" — nový hodnota vedle journal/task/studna
sourceId      String  // EmailMessage.id
chunkIdx      Int     // pořadí v rámci mailu
// VLOŽIT do tabulky další 2 sloupce — migrace:
chunkCount    Int?    // celkový počet chunků mailu (denormalized)
totalTokens   Int?    // pro debugging + náklady reporting
```

### Search workflow

1. Embed query → top-K chunků přes pgvector cosine
2. **Agregace na úroveň mailu** — deduplikovat podle `sourceId`,
   skóre mailu = `max(chunk_score)` všech jeho chunků
3. UI zobrazí mail, podtrhne / scrolne na matched chunk

### Důvody volby

- **Ne čisté per-email:** schránka má 5+ let historie. Dlouhé klientské
  maily, kde jsou ty *opravdu hledané* informace, by se embedovaly
  jako 4000-token vlákno → vektor se rozmáže k nepoužitelnosti.
- **Ne čisté per-chunk:** krátké maily jsou celistvý kontext.
  Drobit je uměle = ztráta soudržnosti. Cena (50 000 mailů × ~2 chunky
  × gemini-embedding-001 ≈ 5-10 USD jednorázově) ani DB velikost
  (pgvector zvládne miliony vektorů) nejsou důvod ke kompromisu.

---

## 3. Vyšumělé závazky — confidence-based routing + odloženo na fázi 6

**Princip:** Plný auto-create = past (LLM si vymýšlí závazky z *„uvidím"*,
*„možná se ozvu"*, *„domluvíme se někdy"* → task systém naplněný
falešnými závazky → ztráta důvěry). Plný flag-and-confirm = past pro
ADHD (každý confirm click je překážka → skončí v zapomenutém přehledu).

**Cesta mezi:** confidence-based routing s feedback loopem.

### Schema `DetectedCommitment`

```ts
model DetectedCommitment {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(...)

  sourceEmailId     String
  sourceEmail       EmailMessage @relation(...)

  quotedText        String   @db.Text  // konkrétní úryvek z mailu
  recipient         String?  // komu (z From/To)
  deadlineHint      String?  // LLM návrh: "pátek", "do konce týdne", null
  proposedTaskTitle String

  confidence        Float    // 0-1 self-report + kalibrace
  routingDecision   String   // "auto" (>=0.85) | "confirm" (0.55-0.85) | "noise" (<0.55)

  status            String   @default("pending")
                             // pending | accepted | rejected | superseded
  taskId            String?  // FK na Task po auto-create / accept
  rejectedReason    String?  // důvod (i prázdný), pro prompt revizi

  detectedAt        DateTime @default(now())
  decidedAt         DateTime?
}
```

### Routing dle confidence

| Confidence | Akce |
|---|---|
| `>= 0.85` | **Auto-create Task** přes smart routing. Flag „auto-detected". V digestu se objeví jako informace. |
| `0.55 – 0.85` | **Flag v digestu**, jednokliková akce „potvrdit / odmítnout" v UI. |
| `< 0.55` | **Debug log**, neuživateli. |

### Klíčové architektonické rozhodnutí

**Úložiště závazků je primárka v Rašeliništi** (`DetectedCommitment`
tabulka). Task v Todoistu / Linearu / Trellu je **sekundární sync**.
Důsledky:

- Závazek se neztratí ani pokud Todoist (nebo budoucí náhrada) selže
- Změna task manageru nevyžaduje migraci závazků
- Petr může závazek odmítnout v Rašeliništi i po accept v Todoistu

### Feedback loop pro zlepšení precision

- Každé `rejected` se ukládá s `rejectedReason` (i prázdným)
- Po **~50 odmítnutích** → manuální prompt revize (NE auto-tuning).
  Typicky se objeví vzor *„LLM si plete podmínečné věty se závazky"*
  nebo *„LLM detekuje závazek u newsletterů"*.
- Incrementální přístup → drží precision pod kontrolou bez toho, aby
  to muselo být perfektní hned.

### **Odložit do FÁZE 6, ne fáze 2**

> Detekce závazků je vrstva, která má pro Petrův profil **nejvyšší
> hodnotu z celého systému**. Stojí za to ji udělat dobře, ne rychle.
> Vyžaduje vyladěný klasifikátor (fáze 2) a chvíli dat (fáze 3-5).

---

## Návrh sekvencování fází

| Fáze | Obsah | Pre-req |
|---|---|---|
| **1 ✅ hotová** | OAuth, schema EmailMessage, sync skeleton, init UI | — |
| **2** | AI klasifikace (7-polní `EmailClassification`) | data z fáze 1 |
| **3** | Modul `/posta` UI — seznam + detail thread + filtry dle action/content/urgency | fáze 2 |
| **4** | RAG hybrid — chunking, embedding pipeline, `RagChunk.sourceType="email"`, search endpoint | fáze 2-3 |
| **5** | Digesty + cleanup cron + šifrování bodyText/Html at-rest + push notifikace (Gmail watch + Cloud Pub/Sub) | fáze 2-4 |
| **6** | Vyšumělé závazky — `DetectedCommitment` + confidence routing + feedback loop | fáze 2 + ~3 měsíce klasifikovaných dat |

---

## Otevřené body (k vyřešení až dojde na konkrétní fázi)

- **Fáze 2:** Gemini Flash batch size pro klasifikaci (10? 20? 50 mailů
  v jednom requestu)? Záleží na token limit per message.
- **Fáze 3:** `/posta` UI — split-pane (left list + right detail) vs
  classic 3-pane (sidebar filters + list + detail)?
- **Fáze 4:** chunking knihovna — vlastní (split po `\n\n` + sentence
  boundary heuristika) nebo `langchain/text-splitter` (přidat dep)?
- **Fáze 5:** GCP setup pro Cloud Pub/Sub — kdo dělá (Petr ručně přes
  konzoli vs my přes Terraform/gcloud CLI)?
- **Fáze 6:** confidence kalibrace — Gemini umí jen self-report.
  Možnost přidat sigmoid s parametry odhadovanými z rejected/accepted
  ratios.
