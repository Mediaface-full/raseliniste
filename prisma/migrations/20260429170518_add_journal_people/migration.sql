-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "people" TEXT[] DEFAULT ARRAY[]::TEXT[];
