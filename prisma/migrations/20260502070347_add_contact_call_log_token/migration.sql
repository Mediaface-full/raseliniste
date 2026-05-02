-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "callLogToken" TEXT;
ALTER TABLE "Contact" ADD COLUMN "callLogTokenCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_callLogToken_key" ON "Contact"("callLogToken");
