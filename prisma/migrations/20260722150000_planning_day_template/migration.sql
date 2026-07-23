-- Šablona týdne — theme days (Petr 2026-07-22, ADHD F3)

CREATE TABLE "PlanningDayTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "PlanningDayTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanningDayTemplate_userId_weekday_key" ON "PlanningDayTemplate"("userId", "weekday");

ALTER TABLE "PlanningDayTemplate" ADD CONSTRAINT "PlanningDayTemplate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
