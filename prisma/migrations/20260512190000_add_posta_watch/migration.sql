-- Pošta — fáze 5: Gmail push (Pub/Sub) watch state na User

ALTER TABLE "User" ADD COLUMN "gmailWatchExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "gmailWatchTopicName" TEXT;
ALTER TABLE "User" ADD COLUMN "gmailLastPushAt" TIMESTAMP(3);
