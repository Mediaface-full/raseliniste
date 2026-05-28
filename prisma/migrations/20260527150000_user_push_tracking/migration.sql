-- Petr 2026-05-27: tracking timestamp pro push-notifications cron.
-- Cron každých 5 min načte items s createdAt > pushLastCheckedAt, pošle
-- push notifikace pro nové (VIP CallLog, urgent EmailMessage, ProjectRecording,
-- CONFIRMED BookingInvite), update timestamp.
--
-- Default null = první cron tick si nastaví na NOW(), žádné staré items
-- se neoznámí retroaktivně.

ALTER TABLE "User" ADD COLUMN "pushLastCheckedAt" TIMESTAMP(3);
