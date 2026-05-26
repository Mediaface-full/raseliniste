-- Petr 2026-05-25: mapování Contact → Todoist Workspace user ID.
-- Když přiřadí úkol členovi týmu (isTeam=true) a má vyplněné todoistUserId,
-- task-todoist-push.ts pošle responsible_uid → Todoist user dostane reálnou
-- notifikaci „máš nový úkol", místo aby viděl jen sekci s jménem.
--
-- ID je string, ne int (Todoist API v1 vrací stringy pro consistency).

ALTER TABLE "Contact" ADD COLUMN "todoistUserId" TEXT;
