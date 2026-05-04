-- Vlastní popisky rituálů per uživatel. Null = default v kódu.
-- Tvar: { "morning_day": "...", "friday_reflection": "...", "weekly_review": "..." }
ALTER TABLE "User" ADD COLUMN "ritualTemplates" JSONB;
