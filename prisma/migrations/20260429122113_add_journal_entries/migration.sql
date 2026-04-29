-- CreateEnum
CREATE TYPE "JournalMood" AS ENUM ('ELATED', 'CONTENT', 'NEUTRAL', 'TIRED', 'STRESSED', 'DOWN', 'ANGRY', 'MIXED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('draft', 'processing', 'ready', 'error');

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "bodyMarkdown" TEXT NOT NULL,
    "rawTranscript" TEXT,
    "mood" "JournalMood",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audioPath" TEXT,
    "audioMime" TEXT,
    "audioBytes" INTEGER,
    "audioDurationSec" INTEGER,
    "audioRetainForever" BOOLEAN NOT NULL DEFAULT false,
    "audioDeletedAt" TIMESTAMP(3),
    "status" "JournalStatus" NOT NULL DEFAULT 'draft',
    "processingError" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalEntry_userId_date_idx" ON "JournalEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_status_idx" ON "JournalEntry"("status");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
