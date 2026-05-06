-- Přílohy ke projektům Studánky/Prskavky (admin upload, žádná AI)
CREATE TABLE "ProjectFile" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mime"         TEXT NOT NULL,
  "bytes"        INTEGER NOT NULL,
  "storagePath"  TEXT NOT NULL,
  "note"         TEXT,
  "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectFile_projectId_uploadedAt_idx" ON "ProjectFile"("projectId", "uploadedAt");

ALTER TABLE "ProjectFile"
  ADD CONSTRAINT "ProjectFile_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
