-- Smart routing — Contact.isTeam + clientTag, audit log
ALTER TABLE "Contact"
  ADD COLUMN "isTeam"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientTag" TEXT;

CREATE INDEX "Contact_userId_isTeam_idx" ON "Contact"("userId", "isTeam");
CREATE INDEX "Contact_userId_clientTag_idx" ON "Contact"("userId", "clientTag");

CREATE TABLE "RoutingAuditLog" (
  "id"                 TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "taskId"             TEXT,
  "taskTitle"          TEXT NOT NULL,
  "rule"               TEXT NOT NULL,
  "matchedValue"       TEXT,
  "todoistProjectName" TEXT,
  "todoistSectionName" TEXT,
  "todoistProjectId"   TEXT,
  "todoistSectionId"   TEXT,
  "autoCreatedProject" BOOLEAN NOT NULL DEFAULT false,
  "autoCreatedSection" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RoutingAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoutingAuditLog_userId_createdAt_idx" ON "RoutingAuditLog"("userId", "createdAt");
CREATE INDEX "RoutingAuditLog_userId_autoCreatedProject_idx" ON "RoutingAuditLog"("userId", "autoCreatedProject");
CREATE INDEX "RoutingAuditLog_userId_autoCreatedSection_idx" ON "RoutingAuditLog"("userId", "autoCreatedSection");
