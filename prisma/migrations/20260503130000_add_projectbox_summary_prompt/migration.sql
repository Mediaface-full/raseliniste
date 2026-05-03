-- Per-projekt vlastní prompt pro Souhrn projektu (summarizeProject — agregát
-- napříč všemi nahrávkami). Null = použije se default v project-summary.ts.
-- Na rozdíl od studnaStandardPrompt/studnaBriefPrompt to NENÍ pro per-recording
-- Stage 2 analýzu, takže nemusí dodržovat JSON schéma — vrací markdown.
ALTER TABLE "ProjectBox" ADD COLUMN "projectSummaryPrompt" TEXT;
