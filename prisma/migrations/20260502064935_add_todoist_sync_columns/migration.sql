-- AlterTable User
ALTER TABLE "User" ADD COLUMN "todoistSyncToken" TEXT;
ALTER TABLE "User" ADD COLUMN "todoistSyncedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "todoistSyncError" TEXT;

-- CreateIndex
CREATE INDEX "Task_userId_todoistTaskId_idx" ON "Task"("userId", "todoistTaskId");
