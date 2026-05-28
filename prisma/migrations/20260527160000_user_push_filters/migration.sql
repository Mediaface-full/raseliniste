-- Petr 2026-05-27: per-source push filters, ať Petr nedostává všechno
-- najednou a může si vybrat co je důležité.
--
-- Default = true pro všechny (zachovat zpětnou kompatibilitu — kdo měl
-- zapnutý push, dostane všechny zdroje). Petr si může v /settings/push
-- vypnout jednotlivé.

ALTER TABLE "User"
  ADD COLUMN "pushVip" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pushUrgentEmail" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pushStudankaGuest" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pushBookingConfirmed" BOOLEAN NOT NULL DEFAULT true;
