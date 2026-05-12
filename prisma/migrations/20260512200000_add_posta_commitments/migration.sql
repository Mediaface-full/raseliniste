-- Pošta — fáze 6: DetectedCommitment + User.gmailEmailAddress

ALTER TABLE "User" ADD COLUMN "gmailEmailAddress" TEXT;

CREATE TABLE "DetectedCommitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEmailId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quotedText" TEXT NOT NULL,
    "recipient" TEXT,
    "recipientEmail" TEXT,
    "proposedTitle" TEXT NOT NULL,
    "deadlineHint" TEXT,
    "parsedDeadline" TIMESTAMP(3),
    "relatedTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mergedInto" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "todoistTaskId" TEXT,
    "relatedEmailIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DetectedCommitment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DetectedCommitment_userId_status_idx" ON "DetectedCommitment"("userId", "status");
CREATE INDEX "DetectedCommitment_userId_lastActionAt_idx" ON "DetectedCommitment"("userId", "lastActionAt");
CREATE INDEX "DetectedCommitment_sourceEmailId_idx" ON "DetectedCommitment"("sourceEmailId");
CREATE INDEX "DetectedCommitment_userId_detectedAt_idx" ON "DetectedCommitment"("userId", "detectedAt");
CREATE INDEX "DetectedCommitment_todoistTaskId_idx" ON "DetectedCommitment"("todoistTaskId");

ALTER TABLE "DetectedCommitment" ADD CONSTRAINT "DetectedCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DetectedCommitment" ADD CONSTRAINT "DetectedCommitment_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
