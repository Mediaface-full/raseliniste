-- Folder support pro Todoist Team Workspace (Petr 2026-05-20).
-- Team nepodporuje sub-projekty přes parent_id, jen folders.
-- Timeline View agreguje projekty stejné složky do jedné timeline.

ALTER TABLE "TodoistProjectMirror"
  ADD COLUMN "folderId" TEXT,
  ADD COLUMN "folderName" TEXT;

CREATE INDEX "TodoistProjectMirror_userId_folderId_idx"
  ON "TodoistProjectMirror"("userId", "folderId");
