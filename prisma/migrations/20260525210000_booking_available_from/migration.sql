-- Petr 2026-05-25: per-invite „sloty dostupné od" — Petr může nastavit datum,
-- před kterým host neuvidí žádné sloty. Doplňuje globální minLeadTime
-- (přísnější z obou platí). Null = jen globální lead time.

ALTER TABLE "BookingInvite" ADD COLUMN "availableFrom" TIMESTAMP(3);
