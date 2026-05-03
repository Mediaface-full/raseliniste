-- Per-projekt override Gemini modelu pro Stage 2 (analýza nahrávky).
-- Null = default chování: BRIEF → ANALYSIS_MODEL (Pro), STANDARD → DEFAULT_MODEL (Flash).
-- Pokud vyplněno (např. "gemini-2.5-pro" nebo "gemini-2.5-flash"), použije se tento model
-- pro Stage 2 bez ohledu na typ nahrávky. Stage 1 (přepis) zůstává vždy Flash.
ALTER TABLE "ProjectBox" ADD COLUMN "analysisModel" TEXT;
