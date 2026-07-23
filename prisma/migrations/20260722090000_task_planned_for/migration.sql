-- Execution date ≠ deadline (Petr 2026-07-22, ADHD plánování F1)
-- Task.plannedFor = KDY to budu dělat (plánovaný den výroby).
-- Rašeliniště-only overlay pole, do Todoistu se nesyncuje.

ALTER TABLE "Task" ADD COLUMN "plannedFor" TIMESTAMP(3);

CREATE INDEX "Task_userId_status_plannedFor_idx" ON "Task"("userId", "status", "plannedFor");
