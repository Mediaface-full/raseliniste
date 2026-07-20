-- Laboratorní výsledky z PDF (Petr 2026-07-16)
--   HealthLabReport: nahrané PDF + AI extrakce status
--   HealthLabResult: jednotlivé hodnoty (analyt, hodnota, jednotka, reference)
--   CASCADE: smazání reportu smaže jeho hodnoty

CREATE TABLE "HealthLabReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "pdfBytes" INTEGER NOT NULL,
    "sampledAt" TIMESTAMP(3),
    "labName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "processingError" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthLabReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HealthLabResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "analyte" TEXT NOT NULL,
    "analyteKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "valueText" TEXT,
    "unit" TEXT,
    "refLow" DOUBLE PRECISION,
    "refHigh" DOUBLE PRECISION,
    "refText" TEXT,
    "flag" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthLabResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthLabReport_userId_sampledAt_idx" ON "HealthLabReport"("userId", "sampledAt");
CREATE INDEX "HealthLabResult_userId_analyteKey_sampledAt_idx" ON "HealthLabResult"("userId", "analyteKey", "sampledAt");
CREATE INDEX "HealthLabResult_reportId_idx" ON "HealthLabResult"("reportId");

ALTER TABLE "HealthLabReport" ADD CONSTRAINT "HealthLabReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HealthLabResult" ADD CONSTRAINT "HealthLabResult_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HealthLabResult" ADD CONSTRAINT "HealthLabResult_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "HealthLabReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
