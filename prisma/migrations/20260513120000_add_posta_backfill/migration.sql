-- Backfill state pro multi-tick zpetny import Gmail historie (6 let).
ALTER TABLE "User"
  ADD COLUMN "gmailBackfillStartedAt"    TIMESTAMP(3),
  ADD COLUMN "gmailBackfillCompletedAt"  TIMESTAMP(3),
  ADD COLUMN "gmailBackfillYears"        INTEGER,
  ADD COLUMN "gmailBackfillPageToken"    TEXT,
  ADD COLUMN "gmailBackfillTotalFetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gmailBackfillError"        TEXT;
