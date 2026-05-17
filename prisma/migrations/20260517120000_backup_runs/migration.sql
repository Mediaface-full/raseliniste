-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "pgDumpOk" BOOLEAN NOT NULL,
    "pgDumpBytes" INTEGER,
    "pgDumpError" TEXT,
    "uploadsTarOk" BOOLEAN NOT NULL,
    "uploadsTarBytes" INTEGER,
    "uploadsTarError" TEXT,
    "rsyncOk" BOOLEAN NOT NULL,
    "rsyncSkipped" BOOLEAN NOT NULL DEFAULT false,
    "rsyncError" TEXT,
    "retentionOk" BOOLEAN NOT NULL,
    "retentionDeleted" INTEGER,
    "retentionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "BackupRun_ok_idx" ON "BackupRun"("ok");
