-- UPLOAD recording type — host nahraje audio soubor, jen přepis bez AI analýzy
ALTER TYPE "RecordingType" ADD VALUE IF NOT EXISTS 'UPLOAD';

-- Per-host permission flag: může nahrávat audio soubory
ALTER TABLE "ProjectInvitation"
  ADD COLUMN "canUploadAudio" BOOLEAN NOT NULL DEFAULT false;

-- Pro UPLOAD recordings: původní filename z disku uploadera (zobrazí se v UI)
ALTER TABLE "ProjectRecording"
  ADD COLUMN "uploadedFilename" TEXT;
