-- Petr 2026-06-09: manuální override Smart routingu v Triage UI.
-- Když AI/routing rozhodne špatně, Petr klikne na chip a vybere projekt sám.
-- Hodnoty se ukládají sem; task-todoist-push.ts je preferuje před resolveRoute().

ALTER TABLE "Task" ADD COLUMN "manualTodoistProjectId" TEXT;
ALTER TABLE "Task" ADD COLUMN "manualTodoistSectionId" TEXT;
