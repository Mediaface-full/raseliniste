-- Pošta — fáze 5: full delete audit log

CREATE TABLE "PostaDeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "subject" TEXT,
    "fromAddress" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT,
    "chunksDeleted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostaDeletionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PostaDeletionLog_userId_deletedAt_idx" ON "PostaDeletionLog"("userId", "deletedAt");
CREATE INDEX "PostaDeletionLog_gmailMessageId_idx" ON "PostaDeletionLog"("gmailMessageId");

ALTER TABLE "PostaDeletionLog" ADD CONSTRAINT "PostaDeletionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
