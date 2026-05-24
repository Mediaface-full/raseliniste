-- MailLog (Petr 2026-05-20) — retrospektivní ověření odeslaných mailů.

CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailLog_to_idx" ON "MailLog"("to");
CREATE INDEX "MailLog_createdAt_idx" ON "MailLog"("createdAt" DESC);
CREATE INDEX "MailLog_context_createdAt_idx" ON "MailLog"("context", "createdAt" DESC);
