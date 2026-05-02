-- CreateTable
CREATE TABLE "TodoistLabelMirror" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "todoistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoistLabelMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoistLabelMirror_userId_idx" ON "TodoistLabelMirror"("userId");

-- CreateIndex
CREATE INDEX "TodoistLabelMirror_userId_name_idx" ON "TodoistLabelMirror"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TodoistLabelMirror_userId_todoistId_key" ON "TodoistLabelMirror"("userId", "todoistId");

-- AddForeignKey
ALTER TABLE "TodoistLabelMirror" ADD CONSTRAINT "TodoistLabelMirror_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
