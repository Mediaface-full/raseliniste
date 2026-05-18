-- Petr 2026-05-18: retry-stuck-recordings cron používal updatedAt ale field
-- v ProjectRecording neexistoval → Prisma ValidationError, cron padal každých
-- 15 min v logu. Přidáno @updatedAt — Prisma sám aktualizuje při každém update.

ALTER TABLE "ProjectRecording"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
