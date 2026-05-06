-- Add status + processingError to DecisionEntry for fire-and-forget audio AI pipeline
ALTER TABLE "DecisionEntry"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN "processingError" TEXT;
