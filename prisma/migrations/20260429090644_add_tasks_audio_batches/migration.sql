-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('manual', 'audio', 'quickadd', 'capture');

-- CreateEnum
CREATE TYPE "TaskBatchStatus" AS ENUM ('processing', 'review', 'committed', 'discarded', 'error');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3),
    "dueIsTime" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "assignedToContactId" TEXT,
    "source" "TaskSource" NOT NULL DEFAULT 'manual',
    "sourceBatchId" TEXT,
    "rawSnippet" TEXT,
    "todoistTaskId" TEXT,
    "todoistProjectId" TEXT,
    "pushedAt" TIMESTAMP(3),
    "pushError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAudioBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audioPath" TEXT,
    "audioMime" TEXT,
    "audioBytes" INTEGER,
    "audioDurationSec" INTEGER,
    "rawTranscript" TEXT,
    "proposalsJson" JSONB,
    "status" "TaskBatchStatus" NOT NULL DEFAULT 'processing',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAudioBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_userId_status_dueAt_idx" ON "Task"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_sourceBatchId_idx" ON "Task"("sourceBatchId");

-- CreateIndex
CREATE INDEX "Task_assignedToContactId_idx" ON "Task"("assignedToContactId");

-- CreateIndex
CREATE INDEX "TaskAudioBatch_userId_status_idx" ON "TaskAudioBatch"("userId", "status");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToContactId_fkey" FOREIGN KEY ("assignedToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "TaskAudioBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAudioBatch" ADD CONSTRAINT "TaskAudioBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
