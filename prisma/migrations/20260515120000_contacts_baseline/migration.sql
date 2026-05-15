-- Banner "Nově přidané z mobilu" (kontakty_brief.md 5.4).
-- Baseline timestamp — kontakty s createdAt > baseline a icloudUid != null
-- = "nově přidané od minulé prohlídky".
ALTER TABLE "User" ADD COLUMN "contactsSeenBaselineAt" TIMESTAMP(3);
