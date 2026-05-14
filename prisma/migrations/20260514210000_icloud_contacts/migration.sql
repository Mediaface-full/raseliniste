-- Contact rozšíření pro iCloud CardDAV sync (kontakty_brief.md fáze 1).

ALTER TABLE "Contact"
  ADD COLUMN "icloudUid"        TEXT,
  ADD COLUMN "icloudEtag"       TEXT,
  ADD COLUMN "icloudHref"       TEXT,
  ADD COLUMN "lastIcloudSyncAt" TIMESTAMP(3),
  ADD COLUMN "company"          TEXT,
  ADD COLUMN "addressLines"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "birthYear"        INTEGER,
  ADD COLUMN "groups"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "syncSource"       TEXT;

CREATE UNIQUE INDEX "Contact_icloudUid_key" ON "Contact"("icloudUid");
CREATE INDEX "Contact_userId_icloudUid_idx" ON "Contact"("userId", "icloudUid");

-- ContactGroup tabulka — Apple skupiny jako samostatný vCard.
CREATE TABLE "ContactGroup" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "memberUids"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  "icloudUid"        TEXT,
  "icloudEtag"       TEXT,
  "icloudHref"       TEXT,
  "lastIcloudSyncAt" TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactGroup_userId_name_key" ON "ContactGroup"("userId", "name");
CREATE UNIQUE INDEX "ContactGroup_icloudUid_key" ON "ContactGroup"("icloudUid");
CREATE INDEX "ContactGroup_userId_idx" ON "ContactGroup"("userId");

ALTER TABLE "ContactGroup"
  ADD CONSTRAINT "ContactGroup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
