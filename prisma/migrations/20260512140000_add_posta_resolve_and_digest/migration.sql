-- Pošta — fáze 3 (2026-05-12)
-- EmailMessage.resolvedAt + resolvedReason (pro "označit jako vyřízené" v UI)
-- EmailDigest tabulka (denní snapshot, 1 řádek per user per den)

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "resolvedReason" TEXT;

-- CreateIndex pro sidebar badge query (count action_required + escalation + resolvedAt IS NULL)
CREATE INDEX "EmailMessage_userId_resolvedAt_idx" ON "EmailMessage"("userId", "resolvedAt");

-- CreateTable
CREATE TABLE "EmailDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" JSONB NOT NULL,
    "viewedAt" TIMESTAMP(3),

    CONSTRAINT "EmailDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (jedna 1:1 per den per user)
CREATE UNIQUE INDEX "EmailDigest_userId_forDate_key" ON "EmailDigest"("userId", "forDate");

-- CreateIndex
CREATE INDEX "EmailDigest_userId_forDate_idx" ON "EmailDigest"("userId", "forDate");

-- AddForeignKey
ALTER TABLE "EmailDigest" ADD CONSTRAINT "EmailDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
