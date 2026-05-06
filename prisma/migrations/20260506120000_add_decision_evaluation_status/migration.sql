-- Add status + processingError to DecisionEvaluation for fire-and-forget AI pipeline
ALTER TABLE "DecisionEvaluation"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN "processingError" TEXT;
