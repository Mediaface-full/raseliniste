# Pošta — fáze 4 (RAG embeddings + hybrid search)

> Stav k 2026-05-12: **HOTOVO**. Fáze 5 (digesty + cleanup + šifrování +
> Gmail push) čeká.

RAG vrstva nad EmailMessage — chunkování + embedding přes Gemini
text-embedding-004 (768 dim, pgvector HNSW) + hybrid search (ILIKE +
vector cosine) v `/posta`.

## Co je hotové

| Komponenta | Kde | Co dělá |
|---|---|---|
| Schema | migrace `add_posta_embed` | `EmailMessage.embeddedAt`, `RagChunk` += chunkCount/tokenCount/sourceKind, `PostaEmbedFailure` DLQ, HNSW index na embedding |
| Chunking lib | `src/lib/posta-chunking.ts` | Hybrid: <500 tok = 1 chunk, >500 = sentence boundary split, thread = chunk per zpráva |
| Embedding pipeline | `src/lib/posta-embed.ts` | `embedEmail`, `embedPendingForUser`, DLQ upsert pri selhání |
| Embed cron | `posta-embed` every 5 min | Batch 50, skip DLQ-exhausted (retryCount >= 3) |
| Backfill skript | `scripts/posta-backfill.ts` | Resumable + lock + JSON log + --confirm |
| Search lib | `src/lib/posta-search.ts` | Hybrid ILIKE + vector, combined 0.4/0.6 |
| Search API | `POST /api/posta/search` | Session auth, zod validation, returns hits + stats |
| Search UI | `/posta.astro` search mode | Search form vrch stránky + 6 facet filters + matched chunk highlight |

## Architektura

```
┌────────────────────────────────────────────────────────────────┐
│ INDEXING PIPELINE                                              │
└────────────────────────────────────────────────────────────────┘

[Cron posta-classify every 15 min]
  └─> klasifikace → EmailMessage.classification = filled

[Cron posta-embed every 5 min]  (DECOUPLED per Petrovo zadani)
  └─> embedPendingForUser:
       SELECT FROM EmailMessage
       WHERE classification IS NOT NULL
         AND embeddedAt IS NULL
         AND id NOT IN (DLQ s retryCount >= 3)
       ORDER BY receivedAt DESC LIMIT 50
       ↓
       per email:
         ├── chunkEmailBody({subject, bodyText})
         │     ├── short mail (< 500 tok) → 1 chunk
         │     ├── thread (reply markery) → chunk per zprava
         │     └── long mail → sentence boundary split (~400 target, 500 cap)
         ├── embedTextsBatch(chunks, concurrency=5)
         ├── DELETE old RagChunk + INSERT new (idempotent)
         ├── UPDATE EmailMessage SET embeddedAt = NOW()
         └── pri chybe: UPSERT PostaEmbedFailure (retryCount++)

[scripts/posta-backfill.ts --confirm]  (jednorazove pro historii)
  └─> Resumable cursor pagination, single instance lock,
       JSON log progress každých 500 mailů, DLQ inheritance
       z embedEmail

┌────────────────────────────────────────────────────────────────┐
│ SEARCH PIPELINE                                                │
└────────────────────────────────────────────────────────────────┘

[Petr v /posta?q=...]
  └─> searchPosta(userId, { query, filters, limit }):
       ├── embedQuery(query) → 768-dim vector
       ├── PARALLEL:
       │     ├── pgvector cosine TOP 50 chunks (HNSW index)
       │     └── ILIKE %query% na subject/from/snippet/body
       ├── merge: per-email max vector chunk score
       ├── ILIKE skore normalized (subject=3, from=2, snippet=1, body=1)
       ├── combined = 0.4 * ILIKE + 0.6 * vector
       ├── apply filters (from, dateFrom/To, urgency, contentType, actionType)
       ├── sort desc, return top limit (default 20, max 50)
       └── log [posta-search] q="..." hits=N vector=K ilike=M durationMs=Yms
```

## DB schema

### `EmailMessage` (nová pole)
```ts
embeddedAt DateTime?   // null = jeste neembed, non-null = hotovo
```

### `RagChunk` (rozšířené pole — sdílí infrastruktura s journal/task/studna)
```ts
sourceType  "email"     // nová hodnota
sourceKind  "body" | "thread_message"   // jen pro email; null pro ostatní
chunkCount  Int?        // denormalized počet chunků pro tento sourceId
tokenCount  Int?        // ~charCount/4 heuristic
```

### `PostaEmbedFailure` (DLQ)
```ts
emailId      String
chunkIndex   Int        // -1 = chyba na úrovni celého mailu, 0+ = per-chunk
error        Text
retryCount   Int        // increment pri kazdem failu
lastAttemptedAt DateTime
@@unique(emailId, chunkIndex)
```

### HNSW index
```sql
CREATE INDEX RagChunk_embedding_hnsw_idx
  ON RagChunk USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

pgvector 0.5+ podporuje HNSW. Petr má 0.8.2 (potvrzeno 2026-04-30).
HNSW je rychlejší než ivfflat při srovnatelném recall, žádné rebuild
po insertu (na rozdíl od ivfflat lists tuning).

## Chunking strategie

Per `INSTRUKCE/POSTA-DESIGN-DECISIONS.md`:

| Vstup | Strategie | sourceKind |
|---|---|---|
| Krátký mail (<500 tok) | 1 chunk = celé tělo (subject prepended) | `body` |
| Dlouhý mail (>500 tok) | Split po větných hranicích, target 400 tok, soft cap 500 | `body` |
| Vlákno (reply markery) | Každá zpráva = vlastní chunk, subject jen u root | `thread_message` |

**Tokenizer:** heuristic **4 znaky ≈ 1 token**. Vertex Gemini tokenizer
není veřejně dostupný, ale tato aproximace je dostatečná pro chunking
decisions. Skutečné token counts jsou ve `response.usageMetadata` z
Gemini API calls (tu zatím neukládáme do DB).

**Reply markery** (regex patterns):
- `\n-{2,}\s*Original Message\s*-{2,}\n` (Outlook EN)
- `\nOn .{1,80}wrote:\n` (Gmail EN)
- `\nDne .{1,80} napsal[a]? .{1,80}:\n` (Gmail CZ)
- `\nFrom: .{1,200}\nSent: .{1,80}\nTo: ` (Outlook EN)
- `\nOd: .{1,200}\nOdesláno: .{1,80}\nKomu: ` (Outlook CZ)

Pokud žádný marker, jedeme single-message strategii.

## Search hybrid scoring

```
combined_score = 0.4 * ILIKE_normalized + 0.6 * vector_score
```

**ILIKE_normalized:**
- Skóre per mail = subject_hit×3 + from_hit×2 + snippet_hit×1 + body_hit×1
- Normalizace = hits / max_hits_acrossResults (0–1)

**vector_score:**
- Per chunk = 1 - cosine_distance/2 (0–1)
- Per mail = max chunk score

**Tuning:** po prvním produkčním použití můžeme zvážit:
- Změna vah (0.3/0.7 více vector? 0.5/0.5 balance?)
- Boost pro recent emaily (faktorovat `receivedAt`)
- BM25 místo ILIKE pro fulltext (PostgreSQL `tsvector` + `to_tsquery`)

## Backfill skript usage

```bash
# Dry-run (zobrazí počty bez zpracování)
npm run posta:backfill

# Skutečné spuštění
npm run posta:backfill -- --confirm

# Konkrétní user (multi-user setup)
npm run posta:backfill -- --confirm --user-id cm123abc

# Test na malém sample
npm run posta:backfill -- --confirm --limit 100

# Force reembed (např. po promtu update)
npm run posta:backfill -- --confirm --force
```

**Resume po Ctrl+C:** prostě znovu spustit s `--confirm`. Skript načte
checkpoint z `./tmp/posta-backfill-state.json` a pokračuje za posledním
zpracovaným mailem.

**Lock soubor** `./tmp/posta-backfill.lock` — pokud druhé spuštění
najde běžící první (kontrola PID), skončí s erorem. Pokud PID
neexistuje (stale lock), automaticky přebere.

**JSON log** `./tmp/posta-backfill.log` (JSONL append-only):
```jsonl
{"at":"...","processed":500,"embedded":487,"failed":13,"rate":4.2}
{"at":"...","processed":1000,...}
{"at":"...","processed":1247,"done":true}
```

## Cost reality check

### Embedding generování
Per chunk ~400 tokens → text-embedding-004:
- $0.000025 / 1K tokens (od Gemini 1.5+ embedding model)
- = $0.00001 per chunk

Petr typická schránka: 10 000 mailů × průměr 2 chunks = 20 000 embeddings:
- **~0.20 USD jednorázový backfill**
- Nový mail ~ 2 chunků = $0.00002 → **měsíčně 600 nových mailů = $0.012**

### Vector storage
- 768-dim float32 = 3072 bytes per vector
- 20 000 chunks × 3072 = 60 MB pgvector storage
- HNSW index ~50 % overhead = 90 MB total

### Search latence
- HNSW search top-50 nad 20K vektorů: **~5-15 ms** v pgvector
- + ILIKE scan ~10-30 ms (DB indexy na subject/from)
- + merge + ranking JS: ~5 ms
- **Total: ~50-100 ms per query**

## Cron joby

| Job | Schedule | Co dělá |
|---|---|---|
| `posta-sync` | every 15 min | Pull nových mailů z Gmail (fáze 1) |
| `posta-classify` | every 15 min | Klasifikace (fáze 2) |
| `posta-embed` | **every 5 min** | RAG embeddings (faze 4) — kratší interval, čerstvost indexu |
| `posta-digest` | daily 7:00 | Digest snapshot (fáze 3) |

## Ověření po deploy

1. **Migrace `add_posta_embed`** — automaticky při container startu
2. **Push commitů + Synology pull** image (cca 5-10 min)
3. **Backfill spuštění:**
   ```bash
   ssh root@SPIZ
   cd /volume1/docker/raseliniste
   sudo docker compose exec app npm run posta:backfill -- --confirm
   ```
   Sleduj progress v `./tmp/posta-backfill.log` nebo stdout.
4. **Po backfillu (5-15 min pro 10K mailů):**
   ```sql
   SELECT COUNT(*) FROM "EmailMessage" WHERE "embeddedAt" IS NOT NULL;
   SELECT COUNT(*) FROM "RagChunk" WHERE "sourceType" = 'email';
   SELECT COUNT(*) FROM "PostaEmbedFailure";
   ```
5. **Test search:**
   - Otevři `/posta?q=cena projektu Karel leden`
   - Měl bys vidět karty s matched chunk highlight (cool-blue border-left)
   - Score breakdown `vec 0.X · text 0.Y · combined 0.Z`
6. **Test facet filters:**
   - `/posta?q=faktura&urgency=high&actionType=action_required`
   - Filtry zúží výsledky

## Známé limity fáze 4

1. **Tokenizer aproximace 4 chars/token** — pro češtinu může být off
   (kratší slova → vyšší token count). Pro chunking decisions OK,
   ale skutečné Gemini token counts mohou být ~20% odlišné.
2. **No re-rank model** — combined score je lineární. Cross-encoder
   re-ranker by zlepšil precision, ale je drahý a faze 4 hranice ho
   nevyžaduje.
3. **No query expansion** — uživatel napíše "faktura TK" → query
   embedding. Mohli bychom rozšířit o synonyma ("TK Stavby", "klient TK")
   ale to je future work.
4. **Bez query history** — každý search je čerstvý. Future: cache
   posledních N queries pro instant re-display.
5. **DLQ retryCount nikdy nedrop down** — jednou v exhausted bucket,
   tam zůstane dokud nesmaž manuálně. Future: `posta-dlq-reset`
   endpoint pro batch retry.
6. **Single-message chunking pri prilis dlouhem mailu**: pokud věta
   sama je > soft cap, hard-splitne na chars. Vzácné, ale možné u
   inline base64 obrazků v body.

## 3 nezodpovězené otázky blokující fázi 5

### 1. 96denní retention bodyText/Html — exact strategie?

Per Petrovo původní rozhodnutí (`POSTA-DESIGN-DECISIONS.md`): 96 dní
keep bodyText/Html, pak nuluj (metadata + klasifikace + embeddings
zůstávají).

**Otázka:** co s embeddings/chunks při retention cleanup?
- **(a)** Smazat i `RagChunk` (search už nenajde body) — radikální cleanup
- **(b)** Ponechat `RagChunk.text` (= zachovaný chunk text bez původního
  full body) — search funguje, ale s redukovaným kontextem
- **(c)** Ponechat embeddings ale smazat `text` v chunk (jen vektory) —
  search najde, ale neukáže preview/snippet

Doporučení: **(b)** — chunks jsou už komprimovaná verze (typicky <500
tokens), neukládá moc dat navíc, zachová search funkcionalitu.

### 2. Šifrování bodyText/Html at-rest

Per design decisions: AES-256-GCM ve fázi 2 odloženo, **fáze 5 to má**.

**Otázka:** stejný klíč jako secrets (`SESSION_SECRET → AES key`) nebo
vlastní `EMAIL_BODY_ENCRYPTION_KEY`?
- **(a)** Stejný — méně env vars, ale kompromitace SESSION_SECRET = únik
  i email body
- **(b)** Vlastní — fyzické oddělení, ale Petr musí spravovat 2 secrets

Doporučení: **(b)** — citlivá data, separace klíčů je standard practice.

### 3. Gmail push notifikace přes Cloud Pub/Sub

Per design decisions: fáze 5 implementuje push notify místo polling à 15 min.

**Otázka:** kdo dělá GCP setup?
- **(a)** Petr ručně přes GCP Console (10 min: aktivovat Pub/Sub API,
  vytvořit topic, service account perm, IAM)
- **(b)** Já automatizovaně přes `gcloud` CLI / Terraform (víc kódu,
  ale reprodukovatelné — pokud Petr přepne projekt)

Doporučení: **(a)** — Petr má jediný GCP projekt, jednorázový setup.
Já připravím detailní step-by-step návod v `INSTRUKCE/POSTA-PUBSUB-SETUP.md`.
