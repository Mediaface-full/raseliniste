-- Pošta — fáze 4 (2026-05-12)
-- RAG embeddings rozšíření: RagChunk metadata + EmailMessage.embeddedAt
-- + PostaEmbedFailure (dead letter queue) + HNSW index

-- AlterTable: EmailMessage embed state
ALTER TABLE "EmailMessage" ADD COLUMN "embeddedAt" TIMESTAMP(3);
CREATE INDEX "EmailMessage_userId_embeddedAt_idx" ON "EmailMessage"("userId", "embeddedAt");

-- AlterTable: RagChunk metadata (chunk count, token count, source kind)
ALTER TABLE "RagChunk" ADD COLUMN "chunkCount" INTEGER;
ALTER TABLE "RagChunk" ADD COLUMN "tokenCount" INTEGER;
ALTER TABLE "RagChunk" ADD COLUMN "sourceKind" TEXT;

-- CreateTable: PostaEmbedFailure (dead letter queue)
CREATE TABLE "PostaEmbedFailure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostaEmbedFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostaEmbedFailure_emailId_chunkIndex_key" ON "PostaEmbedFailure"("emailId", "chunkIndex");
CREATE INDEX "PostaEmbedFailure_userId_lastAttemptedAt_idx" ON "PostaEmbedFailure"("userId", "lastAttemptedAt");

ALTER TABLE "PostaEmbedFailure" ADD CONSTRAINT "PostaEmbedFailure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW index pro pgvector cosine similarity search.
-- pgvector 0.5+ podporuje HNSW (rychlejsi search nez ivfflat, vyssi recall).
-- Petr ma pgvector 0.8.2 (potvrzeno 2026-04-30 session).
-- m=16, ef_construction=64 = balanced defaults dle pgvector docs.
CREATE INDEX IF NOT EXISTS "RagChunk_embedding_hnsw_idx"
  ON "RagChunk" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
