/*
  Warnings:

  - A unique constraint covering the columns `[googleResourceName]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('CLIENT', 'FRIEND');

-- CreateEnum
CREATE TYPE "CalendarSource" AS ENUM ('GOOGLE_PRIMARY', 'ICLOUD_SON', 'ICLOUD_PARTNER', 'RASELINISTE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('MEETING_PRAGUE', 'MEETING_HOME', 'MEETING_ELSEWHERE', 'MEETING_ONLINE', 'PERSONAL', 'HOCKEY_SON', 'PARTNER_SHIFT', 'PARTNER_VACATION', 'OOO_FULL', 'OOO_TRAVEL_WORKING', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingMeetingType" AS ENUM ('CHOICE_PRAGUE', 'CHOICE_ONLINE', 'CHOICE_HOME', 'CHOICE_ANY');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'VIEWED', 'RESERVED', 'CONFIRMED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RuleViolationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "defaultBookingMode" "BookingMode",
ADD COLUMN     "googlePhotoUrl" TEXT,
ADD COLUMN     "googleResourceName" TEXT,
ADD COLUMN     "isClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFamily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFriend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastGoogleSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commuteMinPeak" INTEGER NOT NULL,
    "commuteMinOff" INTEGER NOT NULL,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "source" "CalendarSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "type" "EventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "locationText" TEXT,
    "locationId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "prepNote" TEXT,
    "itemsToBring" JSONB,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "bookingInviteId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "etag" TEXT,
    "deletedRemotely" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "mode" "BookingMode" NOT NULL,
    "meetingType" "BookingMeetingType" NOT NULL,
    "contactId" TEXT,
    "inviteeName" TEXT,
    "inviteeEmail" TEXT,
    "inviteePhone" TEXT,
    "inviteeSubject" TEXT,
    "internalNote" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "reservedSlot" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayNote" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "area" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleViolation" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "eventId" TEXT,
    "ruleName" TEXT NOT NULL,
    "severity" "RuleViolationSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingDigest" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" JSONB NOT NULL,
    "todoistTaskId" TEXT,
    "pushedAt" TIMESTAMP(3),

    CONSTRAINT "BriefingDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_endsAt_idx" ON "CalendarEvent"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_type_startsAt_idx" ON "CalendarEvent"("type", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_source_lastSyncedAt_idx" ON "CalendarEvent"("source", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_source_externalId_key" ON "CalendarEvent"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingInvite_token_key" ON "BookingInvite"("token");

-- CreateIndex
CREATE INDEX "BookingInvite_token_idx" ON "BookingInvite"("token");

-- CreateIndex
CREATE INDEX "BookingInvite_status_validUntil_idx" ON "BookingInvite"("status", "validUntil");

-- CreateIndex
CREATE INDEX "DayNote_forDate_done_idx" ON "DayNote"("forDate", "done");

-- CreateIndex
CREATE INDEX "RuleViolation_forDate_acknowledged_idx" ON "RuleViolation"("forDate", "acknowledged");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingDigest_forDate_key" ON "BriefingDigest"("forDate");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_googleResourceName_key" ON "Contact"("googleResourceName");

-- CreateIndex
CREATE INDEX "Contact_userId_isClient_idx" ON "Contact"("userId", "isClient");

-- CreateIndex
CREATE INDEX "Contact_userId_isFriend_idx" ON "Contact"("userId", "isFriend");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_bookingInviteId_fkey" FOREIGN KEY ("bookingInviteId") REFERENCES "BookingInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
