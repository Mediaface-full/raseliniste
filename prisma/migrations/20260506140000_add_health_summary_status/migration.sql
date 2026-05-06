-- Fire-and-forget status pro long-running AI endpointy
ALTER TABLE "HealthAnalysis"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN "processingError" TEXT;

ALTER TABLE "ProjectSummary"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN "processingError" TEXT;
