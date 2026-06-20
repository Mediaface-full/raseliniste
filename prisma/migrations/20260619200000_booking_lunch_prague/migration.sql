-- Booking lunch v Praze (Petr 2026-06-19)
--   - Nová enum hodnota MEETING_LUNCH_PRAGUE (eventType pro vytvořený Google event)
--   - Nová enum hodnota CHOICE_LUNCH_PRAGUE (BookingMeetingType pro pozvánku)
--   - SchedulingConfig: lunchDays + lunchHoursStart + lunchHoursEnd
--     (Default: žádné dny vybrané, 11:00-13:30 — Petr si dny zapne v /calendar/settings)

ALTER TYPE "EventType" ADD VALUE 'MEETING_LUNCH_PRAGUE';
ALTER TYPE "BookingMeetingType" ADD VALUE 'CHOICE_LUNCH_PRAGUE';

ALTER TABLE "SchedulingConfig"
  ADD COLUMN "lunchDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "lunchHoursStart" TEXT NOT NULL DEFAULT '11:00',
  ADD COLUMN "lunchHoursEnd" TEXT NOT NULL DEFAULT '13:30';
