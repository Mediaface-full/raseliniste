-- GoSMS integrace — SMS zprávy + příchozí odpovědi
-- Per-user credentials zůstávají v UserIntegration(provider="gosms").

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('pending', 'sent', 'delivered', 'undelivered', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gosmsMessageId" TEXT,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invalidRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT NOT NULL,
    "channelId" INTEGER NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'pending',
    "scheduledFor" TIMESTAMP(3),
    "linkedEntity" JSONB,
    "cost" DOUBLE PRECISION,
    "currency" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "deliveryDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsReply" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "smsMessageId" TEXT,
    "gosmsReplyId" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toSourceNumber" TEXT,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "partNumber" INTEGER,
    "partsCount" INTEGER,
    "messageReferenceNumber" INTEGER,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_gosmsMessageId_key" ON "SmsMessage"("gosmsMessageId");

-- CreateIndex
CREATE INDEX "SmsMessage_userId_createdAt_idx" ON "SmsMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_userId_status_idx" ON "SmsMessage"("userId", "status");

-- CreateIndex
CREATE INDEX "SmsMessage_gosmsMessageId_idx" ON "SmsMessage"("gosmsMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsReply_gosmsReplyId_key" ON "SmsReply"("gosmsReplyId");

-- CreateIndex
CREATE INDEX "SmsReply_userId_receivedAt_idx" ON "SmsReply"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "SmsReply_smsMessageId_idx" ON "SmsReply"("smsMessageId");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsReply" ADD CONSTRAINT "SmsReply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsReply" ADD CONSTRAINT "SmsReply_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "SmsMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
