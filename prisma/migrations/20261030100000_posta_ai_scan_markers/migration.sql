-- 2026-10-30 (Vertex náklady): scan marker pro commitment detector + počítadla
-- pokusů, aby se stejné maily neposílaly do Gemini každých 15 min donekonečna.
ALTER TABLE "EmailMessage" ADD COLUMN "commitmentScannedAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN "commitmentScanAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailMessage" ADD COLUMN "classifyAttempts" INTEGER NOT NULL DEFAULT 0;

-- Maily, ke kterým už závazek existuje, jsou naskenované.
UPDATE "EmailMessage" m SET "commitmentScannedAt" = now()
 WHERE EXISTS (SELECT 1 FROM "DetectedCommitment" d WHERE d."sourceEmailId" = m.id);

CREATE INDEX "EmailMessage_userId_commitmentScannedAt_idx" ON "EmailMessage"("userId", "commitmentScannedAt");
