-- Lokální .ics kalendáře (Petr 2026-07-15)
--   - Nová enum hodnota CalendarSource.LOCAL_ICS
--   - Tabulka LocalCalendar (nahrané .ics soubory)
--   - CalendarEvent.localCalendarId FK s ON DELETE CASCADE
--     (smazání kalendáře smaže všechny jeho události)

ALTER TYPE "CalendarSource" ADD VALUE 'LOCAL_ICS';

CREATE TABLE "LocalCalendar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalCalendar_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CalendarEvent" ADD COLUMN "localCalendarId" TEXT;

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_localCalendarId_fkey"
    FOREIGN KEY ("localCalendarId") REFERENCES "LocalCalendar"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CalendarEvent_localCalendarId_idx" ON "CalendarEvent"("localCalendarId");
