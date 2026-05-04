-- Vlastní rituály nad rámec hardcoded 3 default
CREATE TABLE "CustomRitual" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startHour" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL DEFAULT 0,
    "durationMin" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomRitual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomRitual_userId_active_idx" ON "CustomRitual"("userId", "active");

ALTER TABLE "CustomRitual" ADD CONSTRAINT "CustomRitual_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
