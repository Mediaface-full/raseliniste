import { prisma } from "./db";
import { transcribeAudio } from "./audio-transcribe";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import { getPrompt } from "./ai-prompts";

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
  // Načti prompt z DB override / default. Petrův prompt vrací plain markdown
  // s hlavičkou METADATA — heuristicky extrahujeme mood/tags/highlights/title.
  const basePrompt = await getPrompt("ozvena-stage2-journal");
  const prompt = `${basePrompt}

PŘEPIS Z DIKTÁTU:
"""
${transcript}
"""`;

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
        // Bez responseMimeType — prompt vrací plain markdown, ne JSON
      },
    }),
  });

  const raw = (response.text ?? "").trim();
  if (!raw) {
    throw new Error("Strukturování: Vertex vrátil prázdný výstup.");
  }

  return parseJournalMarkdown(raw, transcript);
}

/**
 * Parsuje Petrův markdown výstup s hlavičkou METADATA + body + POZNÁMKY EDITORA.
 * Heuristicky extrahuje:
 *   - title z TÉMATA / UDÁLOSTI
 *   - mood z NÁLADA (pokus o mapping na enum)
 *   - tags z TÉMATA + LIDÉ (lowercase bez háčků)
 *   - highlights z KLÍČOVÉ MOMENTY (řádky)
 *
 * Body je VŽDY celý dokument — Petr nikdy nepřijde o text.
 */
function parseJournalMarkdown(raw: string, fallbackTranscript: string): JournalStructured {
  const bodyMarkdown = raw.slice(0, 50_000) || fallbackTranscript;

  const extractField = (label: string): string => {
    const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i");
    const m = raw.match(re);
    return m ? m[1].trim() : "";
  };

  const moodLine = extractField("NÁLADA").toLowerCase();
  const tematLine = extractField("TÉMATA");
  const lideLine = extractField("LIDÉ");
  const udalostiLine = extractField("UDÁLOSTI");

  // Title — vezmeme první konkrétní událost, nebo téma, jako přibližný titulek
  const title = (udalostiLine.split(/[,;.]/)[0] ?? "").trim().slice(0, 100)
    || (tematLine.split(/[,;.]/)[0] ?? "").trim().slice(0, 100)
    || null;

  // Mood — heuristic mapping z popisu nálady na enum
  const mood = mapMood(moodLine);

  // Tags — z TÉMATA + LIDÉ + UDÁLOSTI vyextrahuj klíčová slova (lowercase, bez háčků)
  const tagsRaw = [...splitToTags(tematLine), ...splitToTags(lideLine)];
  const tags = Array.from(new Set(tagsRaw)).slice(0, 8);

  // Highlights — řádky pod KLÍČOVÉ MOMENTY (pokud začínají na "-" nebo jsou v jednom řádku)
  const highlightsBlock = raw.match(/KLÍČOVÉ MOMENTY\s*:\s*([\s\S]*?)(?:\n[A-ZÁ-Ý]+\s*:|---)/i);
  const highlights = highlightsBlock
    ? highlightsBlock[1].split(/\n/).map((l) => l.replace(/^[-*\s]+/, "").trim()).filter((l) => l.length > 0).slice(0, 5)
    : [];

  return { title, bodyMarkdown, mood, tags, highlights };
}

function splitToTags(text: string): string[] {
  if (!text) return [];
  return text
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .map((s) => s
      .replace(/[áä]/g, "a").replace(/[éě]/g, "e").replace(/[íi]/g, "i")
      .replace(/[óö]/g, "o").replace(/[úůü]/g, "u").replace(/[ý]/g, "y")
      .replace(/[čć]/g, "c").replace(/[ď]/g, "d").replace(/[ňń]/g, "n")
      .replace(/[ř]/g, "r").replace(/[šś]/g, "s").replace(/[ť]/g, "t")
      .replace(/[žź]/g, "z"))
    .map((s) => s.replace(/[^a-z0-9-_]/g, "").slice(0, 30))
    .filter((s) => s.length >= 2 && s.length <= 30);
}

function mapMood(text: string): JournalMoodStr {
  const t = text.toLowerCase();
  if (/(naden|elated|skvel|euforick)/i.test(t)) return "ELATED";
  if (/(spokojen|content|v poh|klidn|smiren)/i.test(t)) return "CONTENT";
  if (/(unav|tired|vycerpan|vyhorel)/i.test(t)) return "TIRED";
  if (/(stres|napjat|uzkost|nervo)/i.test(t)) return "STRESSED";
  if (/(smut|down|teskn|rezigno|deprese|self)/i.test(t)) return "DOWN";
  if (/(naštv|zlostn|hnev|angry|wztek|wtek|vztek)/i.test(t)) return "ANGRY";
  if (/(smišen|smis|mixed|rozporupln)/i.test(t)) return "MIXED";
  return "NEUTRAL";
}
