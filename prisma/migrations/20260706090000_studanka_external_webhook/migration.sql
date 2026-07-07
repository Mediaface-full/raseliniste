-- Integrace Studánka → externí systém (SRO Manager), Petr 2026-07-06.
-- Nullable sloupce, bezpečné pro produkci.
ALTER TABLE "ProjectBox"
  ADD COLUMN "webhookUrl" TEXT,
  ADD COLUMN "webhookSecret" TEXT,
  ADD COLUMN "externalClientRef" TEXT;
