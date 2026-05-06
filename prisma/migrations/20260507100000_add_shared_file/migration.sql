-- Spíž — sdílené soubory s 14denní expirací
CREATE TABLE "SharedFile" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "token"          TEXT NOT NULL,
  "filename"       TEXT NOT NULL,
  "originalName"   TEXT NOT NULL,
  "mime"           TEXT NOT NULL,
  "bytes"          INTEGER NOT NULL,
  "storagePath"    TEXT NOT NULL,
  "uploadedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "downloadCount"  INTEGER NOT NULL DEFAULT 0,
  "lastDownloadAt" TIMESTAMP(3),

  CONSTRAINT "SharedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedFile_token_key" ON "SharedFile"("token");
CREATE INDEX "SharedFile_userId_uploadedAt_idx" ON "SharedFile"("userId", "uploadedAt");
CREATE INDEX "SharedFile_expiresAt_idx" ON "SharedFile"("expiresAt");

ALTER TABLE "SharedFile"
  ADD CONSTRAINT "SharedFile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
