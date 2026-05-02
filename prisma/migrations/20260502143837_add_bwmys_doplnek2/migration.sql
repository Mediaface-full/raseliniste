-- AlterTable Decision — autorství + tok 5 metadata
ALTER TABLE "Decision" ADD COLUMN "autorstvi" TEXT NOT NULL DEFAULT 'pro_me';
ALTER TABLE "Decision" ADD COLUMN "autorstviKdo" TEXT;
ALTER TABLE "Decision" ADD COLUMN "odlozeneUzavreniDo" TIMESTAMP(3);
ALTER TABLE "Decision" ADD COLUMN "uzavrenoPresUpozorneni" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable DecisionEntry — stav nervového systému
ALTER TABLE "DecisionEntry" ADD COLUMN "stavSystemu" TEXT NOT NULL DEFAULT 'nevim';
