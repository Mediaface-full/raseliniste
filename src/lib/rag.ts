/**
 * RAG (Retrieval-Augmented Generation) — modul „Zeptat se".
 *
 * Pipeline:
 *   1. indexEntity(userId, source, text) — chunkuje text, embeddings, ulozi do RagChunk
 *   2. searchChunks(userId, query, topK) — embed dotaz, cosine sim, vrátí top K chunků
 *   3. answerQuestion(userId, query) — search + Gemini Pro generuje odpověď s citacemi
 *
 * Embedding: Gemini text-embedding-004 (768 dim).
 * Vyhledávání: cosine similarity přes pgvector `<=>` operator (raw SQL).
 *
 * Kdy se reindex spouští?
 *   - Při vytvoření/update JournalEntry, Task, ProjectRecording (status=processed)
 *   - Volitelně přes admin „Reindex vše" tlačítko (až bude potřeba)
 *
 * NIKDY ne synchronně v request thread:
 *   - Embedding API call ~300-500 ms; indexEntity je fire-and-forget s pinningem.
 */

import { prisma } from "./db";
import { getGemini, EMBEDDING_MODEL, EMBEDDING_DIM, ANALYSIS_MODEL } from "./gemini";

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

export const CHUNK_SIZE = 600;     // znaků
export const CHUNK_OVERLAP = 100;  // znaků (10-20% pro kontext mezi chunky)
export const SEARCH_TOP_K = 8;     // kolik chunků vrátit do LLM kontextu

export type RagSource = "journal" | "task" | "studna";

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Rozdělí text na chunky o velikosti CHUNK_SIZE s CHUNK_OVERLAP přesahem.
 * Snaží se dělit na hranicích vět/slov, ne uprostřed slova.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= size) return [cleaned];

  const chunks: string[] = [];
  let pos = 0;
  while (pos < cleaned.length) {
    let end = Math.min(pos + size, cleaned.length);
    // Pokud nejsme na konci textu, zkus najít hranici věty/slova trochu zpět
    if (end < cleaned.length) {
      // 1. priorita — konec věty (. ! ?)
      const sentenceBreak = cleaned.lastIndexOf(". ", end);
      if (sentenceBreak > pos + size / 2) {
        end = sentenceBreak + 1;
      } else {
        // 2. priorita — konec slova
        const wordBreak = cleaned.lastIndexOf(" ", end);
        if (wordBreak > pos + size / 2) end = wordBreak;
      }
    }
    chunks.push(cleaned.slice(pos, end).trim());
    if (end >= cleaned.length) break;
    pos = end - overlap;
    if (pos < 0) pos = 0;
  }
  return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Spočítá embedding (768 dim) pro daný text přes Gemini text-embedding-004.
 * Vrací číselné pole `number[]` o délce EMBEDDING_DIM.
 */
export async function embedText(text: string): Promise<number[]> {
  const ai = getGemini();
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType: "RETRIEVAL_DOCUMENT", // pro indexed chunks
      outputDimensionality: EMBEDDING_DIM,
    },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(`embedText: invalid response (got ${values?.length} dims, expected ${EMBEDDING_DIM})`);
  }
  return values;
}

/**
 * Pro vyhledávací dotaz použij `taskType: RETRIEVAL_QUERY` — Gemini ho jinak
 * embedduje než dokument (asymetrický model pro RAG).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const ai = getGemini();
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIM,
    },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(`embedQuery: invalid response`);
  }
  return values;
}

/**
 * Naformátuje number[] do pgvector literal stringu: '[0.1,0.2,...]'
 * Exportováno pro reuse v posta-embed.ts (faze 4).
 */
export function vectorLiteral(arr: number[]): string {
  return "[" + arr.join(",") + "]";
}

/**
 * Batch embed — embed více textů paralelně s rozumnou concurrency.
 * Per Petrovo zadání faze 4: max 5 concurrent proti Vertex rate limitu.
 *
 * Vrací embeddings ve stejném pořadí jako vstupní texty.
 */
export async function embedTextsBatch(texts: string[], concurrency = 5): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = new Array(texts.length);

  // Sliding window — drží `concurrency` Promises in-flight
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= texts.length) return;
      out[i] = await embedText(texts[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

// Module-level pinning fire-and-forget Promise (kritický pattern, viz commit 2f32fac)
interface InFlightIndex {
  sourceType: RagSource;
  sourceId: string;
  startedAt: number;
  promise: Promise<void>;
}
const inFlightIndexes = new Set<InFlightIndex>();

export function getInFlightIndexSnapshot(): Array<{ sourceType: string; sourceId: string; ageMs: number }> {
  const now = Date.now();
  return Array.from(inFlightIndexes).map((f) => ({
    sourceType: f.sourceType,
    sourceId: f.sourceId,
    ageMs: now - f.startedAt,
  }));
}

/**
 * Zaindexuje (nebo reindexuje) zdrojovou entitu — smaže staré chunky pro stejný
 * (sourceType, sourceId), rozkrájí text, spočítá embeddings, vloží.
 *
 * Fire-and-forget: vrátí Promise, ale typicky se nečeká.
 */
export async function indexEntity(params: {
  userId: string;
  sourceType: RagSource;
  sourceId: string;
  text: string;
}): Promise<void> {
  const entry: InFlightIndex = {
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    try {
      const chunks = chunkText(params.text);
      // Smaž staré chunky pro tuhle entitu (idempotent reindex)
      await prisma.ragChunk.deleteMany({
        where: { sourceType: params.sourceType, sourceId: params.sourceId },
      });
      if (chunks.length === 0) return;

      // Embed chunky paralelně (Gemini API toleruje rozumnou paralelu)
      const embeddings = await Promise.all(chunks.map((c) => embedText(c)));

      // Bulk insert přes raw SQL (pgvector formát potřebuje literal)
      // Prisma nezná typ vector, proto $executeRawUnsafe.
      for (let i = 0; i < chunks.length; i++) {
        const id = `rc_${params.sourceType}_${params.sourceId}_${i}_${Date.now()}`;
        // Bezpečný insert přes parametrized query
        await prisma.$executeRawUnsafe(
          `INSERT INTO "RagChunk" ("id","userId","sourceType","sourceId","chunkIdx","text","embedding","createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector,NOW())`,
          id,
          params.userId,
          params.sourceType,
          params.sourceId,
          i,
          chunks[i],
          vectorLiteral(embeddings[i]),
        );
      }
      console.log(`[rag] indexed ${params.sourceType}/${params.sourceId} → ${chunks.length} chunks`);
    } catch (e) {
      console.error(`[rag] indexEntity ${params.sourceType}/${params.sourceId} failed:`, e instanceof Error ? e.message : e);
    } finally {
      inFlightIndexes.delete(entry);
    }
  })();

  inFlightIndexes.add(entry);
  return entry.promise;
}

/**
 * Smaže všechny chunky pro daný zdroj (volat při delete entity).
 */
export async function unindexEntity(sourceType: RagSource, sourceId: string): Promise<void> {
  await prisma.ragChunk.deleteMany({ where: { sourceType, sourceId } });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  sourceType: RagSource;
  sourceId: string;
  chunkIdx: number;
  text: string;
  similarity: number; // 0..1 (1 = perfektní shoda)
}

/**
 * Najde top-K chunků nejbližších k dotazu (cosine similarity).
 * Filtruje na userId — RAG je striktně osobní.
 */
export async function searchChunks(params: {
  userId: string;
  query: string;
  topK?: number;
  sourceTypes?: RagSource[];
}): Promise<SearchResult[]> {
  const queryVec = await embedQuery(params.query);
  const topK = params.topK ?? SEARCH_TOP_K;

  // pgvector `<=>` = cosine distance (0 = shoda, 2 = max). Similarity = 1 - dist/2.
  // sourceTypes filtr přes IN (...) - bezpečně jen pokud whitelist
  const allowed: RagSource[] = ["journal", "task", "studna"];
  const types = (params.sourceTypes ?? allowed).filter((t) => allowed.includes(t));
  const typesLiteral = types.map((t) => `'${t}'`).join(",");

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    chunkIdx: number;
    text: string;
    distance: number;
  }>>(
    `SELECT "id","sourceType","sourceId","chunkIdx","text",
            ("embedding" <=> $1::vector) AS distance
     FROM "RagChunk"
     WHERE "userId" = $2
       AND "sourceType" IN (${typesLiteral})
       AND "embedding" IS NOT NULL
     ORDER BY "embedding" <=> $1::vector
     LIMIT ${Math.max(1, Math.min(50, topK))}`,
    vectorLiteral(queryVec),
    params.userId,
  );

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType as RagSource,
    sourceId: r.sourceId,
    chunkIdx: r.chunkIdx,
    text: r.text,
    similarity: 1 - r.distance / 2,
  }));
}

// ---------------------------------------------------------------------------
// Answer (RAG)
// ---------------------------------------------------------------------------

export interface RagAnswer {
  question: string;
  answer: string;
  citations: Array<{
    sourceType: RagSource;
    sourceId: string;
    chunkIdx: number;
    snippet: string;
    similarity: number;
  }>;
}

/**
 * Search → top K chunků → Gemini Pro vygeneruje odpověď s citacemi.
 */
export async function answerQuestion(params: {
  userId: string;
  question: string;
}): Promise<RagAnswer> {
  const chunks = await searchChunks({
    userId: params.userId,
    query: params.question,
    topK: SEARCH_TOP_K,
  });

  if (chunks.length === 0) {
    return {
      question: params.question,
      answer:
        "Zatím nemám žádné indexované zápisy, ze kterých bych mohl odpovědět. " +
        "Až přidáš pár deníků nebo úkolů, zkus to znovu.",
      citations: [],
    };
  }

  const sourceLabels: Record<RagSource, string> = {
    journal: "Deník",
    task: "Úkol",
    studna: "Studánka",
  };

  // Sestav kontext pro LLM (každý chunk má pořadové ID, na které se odkazuje v citacích)
  const contextLines = chunks.map((c, i) =>
    `[${i + 1}] ${sourceLabels[c.sourceType]} (id: ${c.sourceId})\n${c.text}`,
  ).join("\n\n");

  const prompt = `Jsi asistent Gideona — odpovídej česky, stručně a věcně.

Použij POUZE následující úryvky z Gideonových deníků, úkolů a Studánka nahrávek.
Když odpovídáš, **odkazuj se na úryvky čísly v hranatých závorkách**, např. [1], [2].
Pokud ti úryvky neumožňují odpovědět spolehlivě, řekni to upřímně.

ÚRYVKY:
${contextLines}

DOTAZ GIDEONA:
${params.question}

ODPOVĚĎ (česky, stručně, s [čísly] citací):`;

  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: prompt,
    config: { temperature: 0.3 },
  });

  const answer = response.text?.trim() ?? "(prázdná odpověď)";

  return {
    question: params.question,
    answer,
    citations: chunks.map((c) => ({
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      chunkIdx: c.chunkIdx,
      snippet: c.text.length > 200 ? c.text.slice(0, 200) + "…" : c.text,
      similarity: c.similarity,
    })),
  };
}
