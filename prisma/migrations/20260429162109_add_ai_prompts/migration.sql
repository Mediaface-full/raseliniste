-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPrompt_module_key" ON "AiPrompt"("module");

-- CreateIndex
CREATE INDEX "AiPrompt_module_idx" ON "AiPrompt"("module");
