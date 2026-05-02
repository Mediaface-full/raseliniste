-- CreateTable
CREATE TABLE "TodoistProjectMirror" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "todoistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isInbox" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoistProjectMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoistProjectMirror_userId_idx" ON "TodoistProjectMirror"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TodoistProjectMirror_userId_todoistId_key" ON "TodoistProjectMirror"("userId", "todoistId");

-- AddForeignKey
ALTER TABLE "TodoistProjectMirror" ADD CONSTRAINT "TodoistProjectMirror_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
