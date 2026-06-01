-- Petr 2026-05-27: blacklist emailových odesílatelů/domén pro /notifikace
-- a push cron. Pokud `fromAddress` nebo `fromName` matchuje pattern (podle
-- matchType), email vypadne z agregace urgent.

CREATE TABLE "PostaIgnoreRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'contains',
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostaIgnoreRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostaIgnoreRule_userId_enabled_idx" ON "PostaIgnoreRule"("userId", "enabled");

ALTER TABLE "PostaIgnoreRule" ADD CONSTRAINT "PostaIgnoreRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
