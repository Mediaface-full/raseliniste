-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "birthdayReminderChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "birthdayReminderDaysBefore" INTEGER;

-- CreateTable
CREATE TABLE "Anniversary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "year" INTEGER,
    "note" TEXT,
    "reminderDaysBefore" INTEGER,
    "reminderChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Anniversary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Anniversary_userId_month_day_idx" ON "Anniversary"("userId", "month", "day");

-- AddForeignKey
ALTER TABLE "Anniversary" ADD CONSTRAINT "Anniversary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
