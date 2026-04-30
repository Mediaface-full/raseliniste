-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "RagChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIdx" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagChunk_userId_sourceType_idx" ON "RagChunk"("userId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "RagChunk_sourceType_sourceId_chunkIdx_key" ON "RagChunk"("sourceType", "sourceId", "chunkIdx");

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
