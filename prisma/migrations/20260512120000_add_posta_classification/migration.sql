-- Pošta — fáze 2 (2026-05-12)
-- EmailClassification (1:1 vs EmailMessage) + EmailMessage.hasOutboundCommitmentCandidates
-- (placeholder pro fázi 6, populace přijde s DetectedCommitment).

-- AlterTable: EmailMessage získá placeholder pole pro fázi 6
ALTER TABLE "EmailMessage" ADD COLUMN "hasOutboundCommitmentCandidates" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex pro filtraci v rescanu (fáze 6)
CREATE INDEX "EmailMessage_userId_hasOutboundCommitmentCandidates_idx" ON "EmailMessage"("userId", "hasOutboundCommitmentCandidates");

-- CreateTable
CREATE TABLE "EmailClassification" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "escalation" BOOLEAN NOT NULL DEFAULT false,
    "suggestedAction" TEXT,
    "projectHint" TEXT,
    "reason" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalationDbOverride" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EmailClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailClassification_messageId_key" ON "EmailClassification"("messageId");

-- CreateIndex (pro typické filtry — digest, archivace, eskalace)
CREATE INDEX "EmailClassification_actionType_idx" ON "EmailClassification"("actionType");
CREATE INDEX "EmailClassification_contentType_idx" ON "EmailClassification"("contentType");
CREATE INDEX "EmailClassification_urgency_idx" ON "EmailClassification"("urgency");
CREATE INDEX "EmailClassification_escalation_idx" ON "EmailClassification"("escalation");

-- AddForeignKey
ALTER TABLE "EmailClassification" ADD CONSTRAINT "EmailClassification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
