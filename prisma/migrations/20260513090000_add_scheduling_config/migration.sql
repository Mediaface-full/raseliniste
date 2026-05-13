-- CreateTable
CREATE TABLE "SchedulingConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pragueDays" INTEGER[],
    "pragueHoursStart" TEXT NOT NULL,
    "pragueHoursEnd" TEXT NOT NULL,
    "homeDays" INTEGER[],
    "homeHoursStart" TEXT NOT NULL,
    "homeHoursEnd" TEXT NOT NULL,
    "onlineDays" INTEGER[],
    "onlineHoursStart" TEXT NOT NULL,
    "onlineHoursEnd" TEXT NOT NULL,
    "lunchBreakStart" TEXT NOT NULL,
    "lunchBreakEnd" TEXT NOT NULL,
    "endOfDay" TEXT NOT NULL,
    "bufferPragueMinutes" INTEGER NOT NULL,
    "bufferOnlineBetweenMinutes" INTEGER NOT NULL,
    "minLeadTimeClientHours" INTEGER NOT NULL,
    "minLeadTimeFriendHours" INTEGER NOT NULL,
    "maxBookingHorizonDays" INTEGER NOT NULL,
    "maxPragueWarning" INTEGER NOT NULL,
    "maxInPersonWarning" INTEGER NOT NULL,
    "maxInPersonError" INTEGER NOT NULL,
    "maxOnlineWarning" INTEGER NOT NULL,
    "weightedLoadWarning" DOUBLE PRECISION NOT NULL,
    "weightedLoadError" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingConfig_userId_key" ON "SchedulingConfig"("userId");

-- AddForeignKey
ALTER TABLE "SchedulingConfig" ADD CONSTRAINT "SchedulingConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
