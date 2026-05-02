-- CreateTable
CREATE TABLE "ThingsImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "migrateCount" INTEGER NOT NULL,
    "wishlistCount" INTEGER NOT NULL,
    "discardCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorLog" JSONB,

    CONSTRAINT "ThingsImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThingsImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "thingsUuid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "pushResult" TEXT,
    "pushedTaskId" TEXT,
    "pushedAt" TIMESTAMP(3),

    CONSTRAINT "ThingsImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThingsImport_userId_createdAt_idx" ON "ThingsImport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ThingsImportItem_importId_idx" ON "ThingsImportItem"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "ThingsImportItem_importId_thingsUuid_key" ON "ThingsImportItem"("importId", "thingsUuid");

-- AddForeignKey
ALTER TABLE "ThingsImport" ADD CONSTRAINT "ThingsImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThingsImportItem" ADD CONSTRAINT "ThingsImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ThingsImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
