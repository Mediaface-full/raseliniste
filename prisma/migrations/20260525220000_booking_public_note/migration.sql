-- Petr 2026-05-25: veřejná poznámka co host uvidí v pickeru, v Google
-- kalendářovém eventu (description) a v .ics příloze. Doplňuje internalNote
-- (které je jen pro Petra).

ALTER TABLE "BookingInvite" ADD COLUMN "publicNote" TEXT;
