import { prisma } from "./db";
import { transcribeAudio } from "./audio-transcribe";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

/**
 * Audio → strukturovaný deníkový zápis.
 *
 * Pipeline:
 *  1) Stage 1: transcribe audio přes existující transcribeAudio()
 *  2) Stage 2: structureJournalEntry — Vertex Pro nad přepisem vyrobí
 *     {title, bodyMarkdown, mood, tags, highlights}
 *  3) Uložit do JournalEntry, status=ready
 *
 * NEsmí throw nahoru. Veškeré chyby do entry.processingError.
 *
 * Stejný pin-in-flight pattern jako process-recording.ts kvůli GC.
 */

export type JournalMoodStr = "ELATED" | "CONTENT" | "NEUTRAL" | "TIRED" | "STRESSED" | "DOWN" | "ANGRY" | "MIXED";

export interface JournalStructured {
  title: string;
  bodyMarkdown: string;
  mood: JournalMoodStr;
  tags: string[];
  highlights: string[];
}

interface InFlightJournal {
  entryId: string;
  startedAt: number;
  promise: Promise<void>;
}
const inFlightJournal = new Set<InFlightJournal>();

export function getInFlightJournalSnapshot(): Array<{ entryId: string; ageMs: number }> {
  const now = Date.now();
  return Array.from(inFlightJournal).map((f) => ({ entryId: f.entryId, ageMs: now - f.startedAt }));
}

export async function processJournalAudio(params: {
  entryId: string;
  audio: Buffer;
  mimeType: string;
}): Promise<void> {
  const entry: InFlightJournal = {
    entryId: params.entryId,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    const dbEntry = await prisma.journalEntry.findUnique({ where: { id: params.entryId } });
    if (!dbEntry) {
      console.error(`[process-journal-audio] Entry ${params.entryId} nenalezen.`);
      inFlightJournal.delete(entry);
      return;
    }

    console.log(`[process-journal-audio] ${params.entryId} start (${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB)`);

    try {
      // Stage 1: přepis (reuse audio-transcribe two-stage pipeline,
      // ale my chceme jen transcript — ne projektovou analysis)
      const transcribeResult = await transcribeAudio({
        audio: params.audio,
        mimeType: params.mimeType,
        recordingType: "STANDARD", // deník je středně dlouhý (do 30 min)
        projectContext: null,
      });

      const transcript = transcribeResult.transcript.trim();
      if (!transcript) {
        throw new Error("Přepis je prázdný — nahrávka byla zřejmě tichá.");
      }

      // Uložit transcript hned (kdyby Stage 2 selhal, máme aspoň surový text)
      await prisma.journalEntry.update({
        where: { id: params.entryId },
        data: { rawTranscript: transcript },
      });

      // Stage 2: strukturování
      const structured = await structureJournalEntry(transcript);

      await prisma.journalEntry.update({
        where: { id: params.entryId },
        data: {
          title: structured.title,
          bodyMarkdown: structured.bodyMarkdown,
          mood: structured.mood as never,
          tags: structured.tags,
          highlights: structured.highlights,
          status: "ready",
          processingError: null,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[process-journal-audio] ${params.entryId} failed:`, msg);

      // Pokud máme aspoň přepis, ulož ho jako bodyMarkdown a označ ready
      // s chybou v processingError. Petr to může přečíst, případně regenerovat.
      const current = await prisma.journalEntry.findUnique({ where: { id: params.entryId } });
      if (current?.rawTranscript) {
        await prisma.journalEntry
          .update({
            where: { id: params.entryId },
            data: {
              bodyMarkdown: current.rawTranscript,
              status: "ready",
              processingError: `AI strukturování selhalo (${msg.slice(0, 200)}). Body obsahuje surový přepis. Regeneruj.`,
            },
          })
          .catch(() => null);
      } else {
        await prisma.journalEntry
          .update({
            where: { id: params.entryId },
            data: { status: "error", processingError: msg.slice(0, 1000) },
          })
          .catch(() => null);
      }
    } finally {
      console.log(`[process-journal-audio] ${params.entryId} finished in ${Date.now() - entry.startedAt}ms`);
      inFlightJournal.delete(entry);
    }
  })();

  inFlightJournal.add(entry);
  return entry.promise;
}

// ---------------------------------------------------------------------------
// Strukturování přepisu — Vertex Gemini Pro
// ---------------------------------------------------------------------------

export async function structureJournalEntry(transcript: string): Promise<JournalStructured> {
  const prompt = `Jsi asistent Petra Periny pro vedení osobního deníku. Petr ti dá přepis volně namluveného deníkového záznamu. Tvým úkolem je z toho vyrobit strukturovaný zápis v Petrově hlasu — věcný, krátký, bez literárních ozdob, bez vaty.

PRAVIDLA:
1. **Zachovej Petrův styl:** krátké věty, čeština, neformální tón, občasná vulgarita ano (necenzuruj).
2. **Neměň fakta:** pokud Petr řekne "v úterý jsem byl u doktora", napiš to. Nevymýšlej souvislosti, neinterpretuj nálady, nesnaž se ho povzbudit ani komentovat.
3. **Odstraň výplň:** "no a" / "takže" / "víš co" / opakování / koktání / falešné starty.
4. **Strukturuj do sekcí jen pokud to dává smysl:** pokud zápis pokrývá víc témat, použij ## nadpisy (např. "## Práce", "## Rodina", "## Zdraví"). Pokud je to jeden tok myšlenek, nech to bez nadpisů.
5. **Highlights:** vyber 1–3 nejdůležitější body (rozhodnutí, události, pocity) — krátké bullety, max 80 znaků každý.
6. **Mood:** klasifikuj jednou hodnotou z enum: ELATED / CONTENT / NEUTRAL / TIRED / STRESSED / DOWN / ANGRY / MIXED. Při smíšených pocitech MIXED.
7. **Tags:** 2–6 tagů malými písmeny, česky, bez háčků (např. "prace", "rodina", "spanek", "zdravi", "blanka", "mortyk"). Nepřekládej jména.
8. **Title:** 1 věta, max 60 znaků, věcná. Ne clickbait, ne otázka. Např. "Únavný den po hokeji, večer s Blankou".

PŘEPIS:
"""
${transcript}
"""

Vrať POUZE JSON tohoto tvaru, žádný markdown wrapper:
{
  "title": "...",
  "bodyMarkdown": "...",
  "mood": "CONTENT",
  "tags": ["..."],
  "highlights": ["...", "..."]
}`;

  const genai = getGemini();
  const response = await callTracked({
    module: "journal-structure",
    modelName: ANALYSIS_MODEL,
    fn: () => genai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        temperature: 0.4,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = (response.text ?? "").trim();
  if (!raw) {
    throw new Error("Strukturování: Vertex vrátil prázdný výstup.");
  }

  let parsed: Partial<JournalStructured>;
  try {
    const cleaned = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()
      : raw;
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Strukturování: nelze parse JSON — ${e instanceof Error ? e.message : String(e)}. Prvních 200 znaků: ${raw.slice(0, 200)}`);
  }

  const validMoods: JournalMoodStr[] = ["ELATED", "CONTENT", "NEUTRAL", "TIRED", "STRESSED", "DOWN", "ANGRY", "MIXED"];

  return {
    title: String(parsed.title ?? "").slice(0, 200) || "(bez názvu)",
    bodyMarkdown: String(parsed.bodyMarkdown ?? "").slice(0, 50_000) || transcript,
    mood: validMoods.includes(parsed.mood as JournalMoodStr) ? (parsed.mood as JournalMoodStr) : "NEUTRAL",
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown) => typeof t === "string").slice(0, 8)
      : [],
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((h: unknown) => typeof h === "string").slice(0, 5)
      : [],
  };
}
