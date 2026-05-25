-- Petr 2026-05-25: BookingInvite drží Meet link + Google event ID, aby
-- resend mail mohl poslat skutečný odkaz (nejen "viz Google invite") a
-- diagnose endpoint mohl ukázat celý řetězec bez query do Google API.

ALTER TABLE "BookingInvite"
  ADD COLUMN "meetLink" TEXT,
  ADD COLUMN "googleEventId" TEXT;
