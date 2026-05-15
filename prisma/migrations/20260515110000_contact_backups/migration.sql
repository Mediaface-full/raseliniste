-- Backup tabulka pro kontakty (kontakty_brief.md 5.8 F).
CREATE TABLE "ContactBackup" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "vcardSnapshot" TEXT NOT NULL,
  "contactId"     TEXT,
  "displayName"   TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactBackup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactBackup_userId_createdAt_idx" ON "ContactBackup"("userId", "createdAt");
CREATE INDEX "ContactBackup_contactId_idx" ON "ContactBackup"("contactId");

ALTER TABLE "ContactBackup"
  ADD CONSTRAINT "ContactBackup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
