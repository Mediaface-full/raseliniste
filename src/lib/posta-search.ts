/**
 * Pošta — hybrid search engine.
 *
 * Per Petrovo zadání fáze 4:
 *   - ILIKE fulltext na subject + from + body
 *   - Vector cosine přes pgvector, top-50 chunks
 *   - Merge: každý mail max jednou (max chunk score pro daný mail)
 *   - Re-rank: combined = 0.4 * ILIKE_normalized + 0.6 * vector_score
 *   - Apply filters (from, date range, urgency, contentType, actionType)
 *   - Return top `limit`
 *
 * Vrací mail-level výsledky s metadaty pro UI render (matched chunk
 * highlight, score breakdown, atd.).
 */

import { prisma } from "./db";
import { embedQuery, vectorLiteral } from "./rag";

const ILIKE_WEIGHT = 0.4;
const VECTOR_WEIGHT = 0.6;
const VECTOR_TOP_K = 50;

export interface SearchFilters {
  from?: string;
  dateFrom?: Date;
  dateTo?: Date;
  urgency?: "low" | "medium" | "high";
  contentType?: string;
  actionType?: string;
}

export interface SearchOptions {
  query: string;
  filters?: SearchFilters;
  limit?: number;
}

export interface SearchHit {
  emailId: string;
  gmailMessageId: string;
  threadId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
  resolvedAt: Date | null;
  classification: {
    actionType: string;
    contentType: string;
    urgency: string;
    escalation: boolean;
    suggestedAction: string | null;
    reason: string;
  } | null;
  // Search metadata
  matchedChunkText: string | null; // text chunku s nejlepším skóre
  matchedChunkIdx: number | null;
  vectorScore: number | null;       // 0-1, vyšší = lépe (1 - cosine distance)
  ilikeScore: number;               // 0-1, normalized
  combinedScore: number;            // 0-1, vážená kombinace
}

export interface SearchStats {
  query: string;
  totalHits: number;
  vectorCandidates: number;
  ilikeCandidates: number;
  durationMs: number;
}

interface VectorRow {
  sourceId: string;
  chunkIdx: number;
  text: string;
  distance: number; // 0 = identical, 2 = opposite (cosine distance)
}

interface IlikeRow {
  emailId: string;
  // Skóre podle počtu substring match v subject vs body
  hits: number;
}

/**
 * Hlavni search entry point.
 */
export async function searchPosta(
  userId: string,
  options: SearchOptions,
): Promise<{ hits: SearchHit[]; stats: SearchStats }> {
  const start = Date.now();
  const query = options.query.trim();
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  if (!query) {
    return {
      hits: [],
      stats: {
        query,
        totalHits: 0,
        vectorCandidates: 0,
        ilikeCandidates: 0,
        durationMs: Date.now() - start,
      },
    };
  }

  // --- Vector search (top 50 chunks across emails) ---
  let vectorRows: VectorRow[] = [];
  try {
    const queryVec = await embedQuery(query);
    const rows = await prisma.$queryRawUnsafe<VectorRow[]>(
      `SELECT "sourceId", "chunkIdx", "text",
              ("embedding" <=> $1::vector) AS distance
       FROM "RagChunk"
       WHERE "userId" = $2
         AND "sourceType" = 'email'
         AND "embedding" IS NOT NULL
       ORDER BY "embedding" <=> $1::vector
       LIMIT $3`,
      vectorLiteral(queryVec),
      userId,
      VECTOR_TOP_K,
    );
    vectorRows = rows;
  } catch (err) {
    console.warn(`[posta-search] vector failed: ${err instanceof Error ? err.message : err}`);
    // Pokračujeme jen s ILIKE
  }

  // --- ILIKE search (subject + fromAddress + fromName + snippet + bodyText) ---
  // Pattern matching s wildcards
  const ilikePattern = `%${escapePercentUnderscore(query)}%`;
  const ilikeMatches = await prisma.emailMessage.findMany({
    where: {
      userId,
      OR: [
        { subject: { contains: query, mode: "insensitive" } },
        { fromAddress: { contains: query, mode: "insensitive" } },
        { fromName: { contains: query, mode: "insensitive" } },
        { snippet: { contains: query, mode: "insensitive" } },
        { bodyText: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, subject: true, fromAddress: true, fromName: true, snippet: true, bodyText: true },
    take: 100,
  });

  // ILIKE skore: subject match = 3, from = 2, snippet = 1, body = 1
  // Normalizace na 0-1 (rozdelime max nalezeným)
  const ilikeRaw: IlikeRow[] = ilikeMatches.map((e) => {
    let hits = 0;
    const q = query.toLowerCase();
    if (e.subject?.toLowerCase().includes(q)) hits += 3;
    if (e.fromAddress.toLowerCase().includes(q)) hits += 2;
    if (e.fromName?.toLowerCase().includes(q)) hits += 2;
    if (e.snippet?.toLowerCase().includes(q)) hits += 1;
    if (e.bodyText?.toLowerCase().includes(q)) hits += 1;
    return { emailId: e.id, hits };
  });
  const maxIlikeHits = Math.max(1, ...ilikeRaw.map((r) => r.hits));
  const ilikeScoreMap = new Map<string, number>();
  for (const r of ilikeRaw) {
    ilikeScoreMap.set(r.emailId, r.hits / maxIlikeHits);
  }

  // --- Merge: per-email max vector score + matched chunk text ---
  // Vector distance 0 = identical, 2 = opposite → score = 1 - distance/2 (0-1)
  const vectorBestMap = new Map<
    string,
    { score: number; chunkIdx: number; text: string }
  >();
  for (const r of vectorRows) {
    const score = Math.max(0, 1 - r.distance / 2);
    const existing = vectorBestMap.get(r.sourceId);
    if (!existing || score > existing.score) {
      vectorBestMap.set(r.sourceId, { score, chunkIdx: r.chunkIdx, text: r.text });
    }
  }

  // Union of email IDs from both sources
  const candidateIds = new Set<string>([
    ...Array.from(vectorBestMap.keys()),
    ...Array.from(ilikeScoreMap.keys()),
  ]);

  if (candidateIds.size === 0) {
    return {
      hits: [],
      stats: {
        query,
        totalHits: 0,
        vectorCandidates: vectorBestMap.size,
        ilikeCandidates: ilikeScoreMap.size,
        durationMs: Date.now() - start,
      },
    };
  }

  // --- Načti EmailMessage + classification, aplikuj filters ---
  const where: Record<string, unknown> = {
    userId,
    id: { in: Array.from(candidateIds) },
  };
  const filters = options.filters ?? {};
  if (filters.from) {
    where.OR = [
      { fromAddress: { contains: filters.from, mode: "insensitive" } },
      { fromName: { contains: filters.from, mode: "insensitive" } },
    ];
  }
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.gte = filters.dateFrom;
    if (filters.dateTo) range.lte = filters.dateTo;
    where.receivedAt = range;
  }
  if (filters.urgency || filters.contentType || filters.actionType) {
    const clsWhere: Record<string, unknown> = {};
    if (filters.urgency) clsWhere.urgency = filters.urgency;
    if (filters.contentType) clsWhere.contentType = filters.contentType;
    if (filters.actionType) clsWhere.actionType = filters.actionType;
    where.classification = clsWhere;
  }

  const emails = await prisma.emailMessage.findMany({
    where: where as never,
    include: { classification: true },
  });

  // --- Build hits with scoring ---
  const hits: SearchHit[] = emails.map((e) => {
    const vectorBest = vectorBestMap.get(e.id);
    const vectorScore = vectorBest?.score ?? 0;
    const ilikeScore = ilikeScoreMap.get(e.id) ?? 0;
    const combinedScore = ILIKE_WEIGHT * ilikeScore + VECTOR_WEIGHT * vectorScore;

    return {
      emailId: e.id,
      gmailMessageId: e.gmailMessageId,
      threadId: e.threadId,
      fromAddress: e.fromAddress,
      fromName: e.fromName,
      subject: e.subject,
      snippet: e.snippet,
      receivedAt: e.receivedAt,
      resolvedAt: e.resolvedAt,
      classification: e.classification
        ? {
            actionType: e.classification.actionType,
            contentType: e.classification.contentType,
            urgency: e.classification.urgency,
            escalation: e.classification.escalation,
            suggestedAction: e.classification.suggestedAction,
            reason: e.classification.reason,
          }
        : null,
      matchedChunkText: vectorBest?.text ?? null,
      matchedChunkIdx: vectorBest?.chunkIdx ?? null,
      vectorScore: vectorBest ? vectorScore : null,
      ilikeScore,
      combinedScore,
    };
  });

  // Sort desc by combined score, take top `limit`
  hits.sort((a, b) => b.combinedScore - a.combinedScore);
  const topHits = hits.slice(0, limit);

  const stats: SearchStats = {
    query,
    totalHits: topHits.length,
    vectorCandidates: vectorBestMap.size,
    ilikeCandidates: ilikeScoreMap.size,
    durationMs: Date.now() - start,
  };

  console.log(
    `[posta-search] userId=${userId} q="${query.slice(0, 50)}" hits=${topHits.length} vector=${vectorBestMap.size} ilike=${ilikeScoreMap.size} duration=${stats.durationMs}ms`,
  );

  return { hits: topHits, stats };
}

function escapePercentUnderscore(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}
