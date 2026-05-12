-- Pošta — fáze 5: AES-256-GCM encryption pro bodyText/bodyHtml at-rest

-- EncryptionKey: versioning pro klíče, plain key NIKDY v DB
CREATE TABLE "EncryptionKey" (
    "id" SERIAL NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "keyHashSha256" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "EncryptionKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EncryptionKey_keyId_key" ON "EncryptionKey"("keyId");

-- EmailMessage: nová pole pro encrypted blobs (legacy bodyText/Html zůstává)
ALTER TABLE "EmailMessage" ADD COLUMN "bodyTextCiphertext" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "bodyHtmlCiphertext" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "bodyEncryptionKeyId" TEXT;

-- Bez FK constraint na keyId, protože EncryptionKey může mít retired stav
-- ale my chceme stále moct decrypt starší data. Aplikace si keyId validuje
-- při decrypt logic.
