-- Real-time progress sync — Petr 2026-05-16: chce čísla v banneru během sync.
ALTER TABLE "User" ADD COLUMN "contactsSyncProgress" JSONB;
