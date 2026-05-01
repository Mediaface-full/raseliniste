-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nazev" TEXT NOT NULL,
    "kontext" TEXT NOT NULL,
    "otazka" TEXT NOT NULL,
    "varianty" JSONB NOT NULL,
    "predpoklady" JSONB NOT NULL,
    "deadlineRozhodnuti" TIMESTAMP(3) NOT NULL,
    "delkaSberuDny" INTEGER NOT NULL DEFAULT 14,
    "status" TEXT NOT NULL DEFAULT 'aktivni',
    "datumVytvoreni" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datumUzavreni" TIMESTAMP(3),
    "datumRevize" TIMESTAMP(3),
    "odlozenoDo" TIMESTAMP(3),
    "verdiktText" TEXT,
    "coByZmeniloVerdikt" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEntry" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nalada" INTEGER NOT NULL,
    "typVstupu" TEXT NOT NULL,
    "uhelPohledu" TEXT NOT NULL DEFAULT 'nevybrano',
    "obsah" TEXT NOT NULL,
    "uhelPohleduAi" TEXT,
    "audioPath" TEXT,
    "audioMime" TEXT,
    "audioBytes" INTEGER,

    CONSTRAINT "DecisionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvaluation" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "typ" TEXT NOT NULL,
    "obsahStrukturovany" JSONB NOT NULL,
    "pocetVstupuVDobeGenerovani" INTEGER NOT NULL,
    "modelName" TEXT,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,

    CONSTRAINT "DecisionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionReopening" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "popisNovehoFaktu" TEXT NOT NULL,
    "schvaleno" BOOLEAN NOT NULL,

    CONSTRAINT "DecisionReopening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Decision_userId_status_idx" ON "Decision"("userId", "status");

-- CreateIndex
CREATE INDEX "Decision_userId_datumVytvoreni_idx" ON "Decision"("userId", "datumVytvoreni");

-- CreateIndex
CREATE INDEX "Decision_odlozenoDo_idx" ON "Decision"("odlozenoDo");

-- CreateIndex
CREATE INDEX "DecisionEntry_decisionId_datum_idx" ON "DecisionEntry"("decisionId", "datum");

-- CreateIndex
CREATE INDEX "DecisionEvaluation_decisionId_datum_idx" ON "DecisionEvaluation"("decisionId", "datum");

-- CreateIndex
CREATE INDEX "DecisionReopening_decisionId_datum_idx" ON "DecisionReopening"("decisionId", "datum");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEntry" ADD CONSTRAINT "DecisionEntry_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvaluation" ADD CONSTRAINT "DecisionEvaluation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionReopening" ADD CONSTRAINT "DecisionReopening_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
