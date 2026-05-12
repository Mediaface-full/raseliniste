/**
 * Pošta — embedding pipeline.
 *
 * Decoupling per Petrovo zadání fáze 4: NIKDY sync v posta-classify.ts.
 * Klasifikace nastaví classification, samostatný worker `posta-embed`
 * (cron každých 5 min) pak najde unembed maily a vygeneruje chunks +
 * embeddings.
 *
 * Flow per email:
 *   1. Načti EmailMessage (bodyText preferovaný, HTML stripped fallback)
 *   2. chunkEmailBody({subject, bodyText}) → EmailChunk[]
 *   3. embedTextsBatch(chunks, concurrency=5) → number[][]
 *   4. Smaž staré RagChunk pro (sourceType="email", sourceId=email.id)
 *      [idempotentni re-embed]
 *   5. Bulk insert nových RagChunk s pgvector literal
 *   6. UPDATE EmailMessage SET embeddedAt = now()
 *   7. Při chybě → upsert do PostaEmbedFailure, NEsetni embeddedAt
 *
 * Dead letter queue:
 *   PostaEmbedFailure záznamy s retryCount >= 3 NEJSOU automaticky retried.
 *   Petr je musí manuálně vyřešit (smazat z DLQ + force re-embed přes endpoint).
 */

import { prisma } from "./db";
import { embedTextsBatch, vectorLiteral } from "./rag";
import { chunkEmailBody } from "./posta-chunking";

const MAX_RETRY_BEFORE_DLQ = 3;
const EMBED_CONCURRENCY = 5;

export interface EmbedStats {
  emailId: string;
  ok: boolean;
  skipped?: boolean; // už embeded + force=false
  chunksCreated?: number;
  durationMs: number;
  error?: string;
}

export interface EmbedOptions {
  /** Reembed i pokud má embeddedAt. Default false. */
  force?: boolean;
}

/**
 * Embed jeden email — vrátí stats. Idempotent (smaže staré chunks před insert).
 */
export async function embedEmail(emailId: string, options: EmbedOptions = {}): Promise<EmbedStats> {
  const start = Date.now();
  const stats: EmbedStats = { emailId, ok: false, durationMs: 0 };

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      userId: true,
      subject: true,
      bodyText: true,
      bodyHtml: true,
      snippet: true,
      embeddedAt: true,
    },
  });

  if (!email) {
    stats.error = "EMAIL_NOT_FOUND";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  if (email.embeddedAt && !options.force) {
    stats.ok = true;
    stats.skipped = true;
    stats.durationMs = Date.now() - start;
    return stats;
  }

  // Body fallback: text → HTML stripped → snippet
  const bodyText =
    email.bodyText ||
    (email.bodyHtml ? stripHtml(email.bodyHtml) : "") ||
    email.snippet ||
    "";

  // Chunking
  const chunks = chunkEmailBody({ subject: email.subject, bodyText });
  if (chunks.length === 0) {
    // Žádný content k embed (prázdný mail). Označíme jako "embedded" aby cron
    // ho znovu nevracel, ale chunks nevytvoříme.
    await prisma.emailMessage.update({
      where: { id: emailId },
      data: { embeddedAt: new Date() },
    });
    stats.ok = true;
    stats.chunksCreated = 0;
    stats.durationMs = Date.now() - start;
    return stats;
  }

  try {
    // Embed všechny chunks paralelně s concurrency 5
    const embeddings = await embedTextsBatch(
      chunks.map((c) => c.text),
      EMBED_CONCURRENCY,
    );

    // Transakce: smaž staré + insert nové + update embeddedAt + clean DLQ
    // (Prisma neumí raw SQL v $transaction, takže používáme sequence
    // operací — pgvector raw insert nelze transactionalizovat s typed API)
    await prisma.ragChunk.deleteMany({
      where: { sourceType: "email", sourceId: emailId },
    });

    const chunkCount = chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = `rc_email_${emailId}_${i}_${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RagChunk" ("id","userId","sourceType","sourceId","chunkIdx","text","chunkCount","tokenCount","sourceKind","embedding","createdAt")
         VALUES ($1,$2,'email',$3,$4,$5,$6,$7,$8,$9::vector,NOW())`,
        id,
        email.userId,
        emailId,
        i,
        chunk.text,
        chunkCount,
        chunk.tokenCount,
        chunk.sourceKind,
        vectorLiteral(embeddings[i]),
      );
    }

    await prisma.emailMessage.update({
      where: { id: emailId },
      data: { embeddedAt: new Date() },
    });

    // Po úspěchu smaž případné DLQ entries pro tento email
    await prisma.postaEmbedFailure
      .deleteMany({ where: { emailId } })
      .catch(() => null);

    stats.ok = true;
    stats.chunksCreated = chunkCount;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.error = msg;

    // DLQ upsert — chunkIndex = -1 pro chyby na úrovni celého mailu
    await prisma.postaEmbedFailure
      .upsert({
        where: { emailId_chunkIndex: { emailId, chunkIndex: -1 } },
        create: {
          userId: email.userId,
          emailId,
          chunkIndex: -1,
          error: msg.slice(0, 2000),
          retryCount: 1,
          lastAttemptedAt: new Date(),
        },
        update: {
          error: msg.slice(0, 2000),
          retryCount: { increment: 1 },
          lastAttemptedAt: new Date(),
        },
      })
      .catch((e) => {
        console.warn(`[posta-embed] DLQ upsert failed for ${emailId}: ${e instanceof Error ? e.message : e}`);
      });

    console.warn(`[posta-embed] emailId=${emailId} FAILED: ${msg.slice(0, 300)}`);
  }

  stats.durationMs = Date.now() - start;
  return stats;
}

// ---------------------------------------------------------------------------
// Batch worker
// ---------------------------------------------------------------------------

export interface BatchEmbedStats {
  userId: string;
  total: number;
  embedded: number;
  skipped: number;
  failed: number;
  durationMs: number;
  errorDetails: Array<{ emailId: string; error: string }>;
}

/**
 * Najde unembed klasifikované maily a embeduje je (max `limit`).
 * Volá cron `posta-embed` à 5 min.
 *
 * Filter: vynechá maily co jsou v DLQ s retryCount >= MAX_RETRY_BEFORE_DLQ
 * (musí být manuálně reseted, jinak by cron zbytečně retryoval).
 */
export async function embedPendingForUser(
  userId: string,
  limit = 50,
): Promise<BatchEmbedStats> {
  const start = Date.now();

  // Najdi maily co potřebují embed
  // - klasifikované (classification IS NOT NULL)
  // - ne-embed (embeddedAt IS NULL)
  // - NE v DLQ s retryCount >= 3
  const dlqExhaustedIds = await prisma.postaEmbedFailure.findMany({
    where: { userId, retryCount: { gte: MAX_RETRY_BEFORE_DLQ } },
    select: { emailId: true },
  });
  const exhaustedSet = new Set(dlqExhaustedIds.map((d) => d.emailId));

  const candidates = await prisma.emailMessage.findMany({
    where: {
      userId,
      embeddedAt: null,
      classification: { isNot: null },
      ...(exhaustedSet.size > 0 ? { id: { notIn: Array.from(exhaustedSet) } } : {}),
    },
    select: { id: true },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });

  const stats: BatchEmbedStats = {
    userId,
    total: candidates.length,
    embedded: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
    errorDetails: [],
  };

  if (candidates.length === 0) {
    stats.durationMs = Date.now() - start;
    console.log(
      `[posta-embed] userId=${userId} no pending emails (DLQ exhausted: ${exhaustedSet.size})`,
    );
    return stats;
  }

  // Sequential per-email (uvnitř embedEmail je concurrency 5 přes chunky)
  // Důvod: kdybychom paralelizovali per-email * 5 chunks = 25+ Vertex calls/s,
  // hrozí rate limit. Per-email serial je bezpečnější.
  for (const c of candidates) {
    const result = await embedEmail(c.id, { force: false });
    if (result.ok && !result.skipped) stats.embedded++;
    else if (result.skipped) stats.skipped++;
    else {
      stats.failed++;
      stats.errorDetails.push({
        emailId: c.id,
        error: (result.error ?? "?").slice(0, 200),
      });
    }
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-embed] userId=${userId} total=${stats.total} embedded=${stats.embedded} skipped=${stats.skipped} failed=${stats.failed} duration=${stats.durationMs}ms`,
  );
  return stats;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
