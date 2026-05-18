-- Team Workspace support pro Todoist integraci (Cesta B, Petr 2026-05-18)
-- Sync API vrací workspace_id pro Team projekty, null pro Personal.

ALTER TABLE "TodoistProjectMirror"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "isTeamProject" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessVisibility" TEXT;

CREATE INDEX "TodoistProjectMirror_userId_workspaceId_idx"
  ON "TodoistProjectMirror"("userId", "workspaceId");
