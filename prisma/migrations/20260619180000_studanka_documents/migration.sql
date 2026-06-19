-- Petr 2026-06-19: Studánka host umožňuje nahrávat dokumenty (PDF/DOCX/XLSX/TXT)
-- vedle audio. Dokumenty se ukládají do ProjectFile + automaticky se z nich
-- extrahuje text a indexuje do RAG znalostní báze projektu.

ALTER TABLE "ProjectFile" ADD COLUMN "guestUserId" TEXT;
ALTER TABLE "ProjectFile" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "ProjectFile" ADD COLUMN "extractionStatus" TEXT;
ALTER TABLE "ProjectFile" ADD COLUMN "extractionError" TEXT;

ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_guestUserId_fkey"
  FOREIGN KEY ("guestUserId") REFERENCES "GuestUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProjectFile_guestUserId_idx" ON "ProjectFile"("guestUserId");
