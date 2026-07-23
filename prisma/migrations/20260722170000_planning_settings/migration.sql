-- Nastavení plánování — digest pro kolegyni (ADHD F4, Petr 2026-07-22)

CREATE TABLE "PlanningSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestContactId" TEXT,

    CONSTRAINT "PlanningSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanningSettings_userId_key" ON "PlanningSettings"("userId");

ALTER TABLE "PlanningSettings" ADD CONSTRAINT "PlanningSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanningSettings" ADD CONSTRAINT "PlanningSettings_digestContactId_fkey"
    FOREIGN KEY ("digestContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
