-- Volný text vedle hlasové nahrávky (URL, jména, čísla — věci co se zkomolí v hlasu)
-- Není AI analyzováno, jen archivováno.
ALTER TABLE "ProjectRecording" ADD COLUMN "guestNote" TEXT;
