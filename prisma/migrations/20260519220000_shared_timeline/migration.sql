-- Project Timeline View — F4 share link (Petr 2026-05-19)
-- Public read-only URL pro klienty bez loginu.

CREATE TABLE "SharedTimeline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SharedTimeline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedTimeline_token_key" ON "SharedTimeline"("token");
CREATE INDEX "SharedTimeline_userId_idx" ON "SharedTimeline"("userId");
CREATE INDEX "SharedTimeline_token_idx" ON "SharedTimeline"("token");
CREATE INDEX "SharedTimeline_expiresAt_idx" ON "SharedTimeline"("expiresAt");

ALTER TABLE "SharedTimeline"
  ADD CONSTRAINT "SharedTimeline_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
