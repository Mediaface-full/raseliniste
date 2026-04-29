/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI } from "@google/genai";
import { getGemini, getGeminiMode, DEFAULT_MODEL, ANALYSIS_MODEL } from "./gemini";
import { env } from "./env";
import { trackGeminiCall } from "./gemini-usage";
import { getPrompt } from "./ai-prompts";

/**
 * Audio transkripce + bohatá strukturovaná analýza pro Studnu.
 *
 * Dva režimy:
 *   - STANDARD (Flash 2.5)   — krátký záznam (do 10 min), ekonomický
 *   - BRIEF    (Pro 2.5)     — klíčový brief (do 90 min), hloubková analýza
 *
 * Vstup: Buffer s audio + MIME (audio/webm, audio/mp4, audio/mpeg, audio/wav, …)
 * Výstup: { transcript, analysis (JSON) }
 *
 * Gemini 2.5 podporuje audio input nativně — žádný Whisper, žádný extra hop.
 */

export type RecordingTypeStr = "STANDARD" | "BRIEF";

export interface AudioAnalysis {
  summary: string;
  key_themes: string[];
  thoughts: Array<{
    text: string;
    importance: "high" | "medium" | "low";
    rationale: string;
    category: string;
  }>;
  open_questions: string[];
  sentiment: string;
  intensity_signals: string;
  // Pouze pro BRIEF
  glossary?: Array<{ term: string; definition: string }>;
  actors?: Array<{ name: string; role: string }>;
  decision_history?: string[];
}

export interface TranscribeResult {
  transcript: string;
  analysis: AudioAnalysis;
  model: string;
  promptChars: number;
}

const STANDARD_PROMPT = (projectContext: string | null) => `Jsi asistent, který zpracovává hlasové záznamy projektového brainstormingu pro Petra. Audio ti pošlu jako vstup.

${projectContext ? `Kontext projektu: ${projectContext}\n` : ""}
Tvoje úkoly:

1. **Doslovný přepis** mluveného textu (\`transcript\`). Zachovej tón, opakování, váhání i nedokončené věty — to je signál o důrazu. Drobně oprav jen očividné gramatické chyby a doplň interpunkci/odstavce. Žádné "hm", "no", "tak" odstraňovat nemusíš, pokud nesou význam.

2. **Bohatý souhrn** (\`summary\`) — 200-500 slov, strukturovaný do 2-4 odstavců. Ne jednovětný telegram. Přepiš co nejvěrněji, co autor říkal, jak o tom přemýšlel, kam směřoval. Zmiň všechny myšlenky, ne jen "hlavní".

3. **Hlavní témata** (\`key_themes\`) — 2-5 výstižných pojmů.

4. **Konkrétní myšlenky** (\`thoughts\`) — vyextrahuj VŠECHNY individuální myšlenky / nápady / pozorování / akce, které v záznamu zaznívají. Lépe víc krátkých než pár obecných. Pro každou:
   - \`text\`: konkrétní věta (max 200 znaků)
   - \`importance\`: "high" | "medium" | "low" — odhad podle:
     * důrazu v hlasu (pokud detekuješ ze záznamu)
     * opakování / návratu k tématu
     * pozice v záznamu (otevírací / uzavírací myšlenky bývají důležitější)
     * konkrétnosti vs. obecnosti
   - \`rationale\`: 1 věta proč to vidíš na dané úrovni důležitosti
   - \`category\`: jedno z {"nápad", "rozhodnutí", "otázka", "pozorování", "akce", "kontext"}

5. **Otevřené otázky** (\`open_questions\`) — co padlo bez odpovědi, na co by se měl autor / tým zaměřit.

6. **Sentiment** (\`sentiment\`) — jedno z: "constructive", "concerned", "excited", "analytical", "uncertain", "frustrated".

7. **Intensity signals** (\`intensity_signals\`) — krátká poznámka (1-3 věty) o tom, čemu autor věnoval nejvíc času, kde zaváhal, co opakoval, kde mluvil rychleji nebo pomaleji. Tohle je zlato pro pochopení priorit autora.

Vrať VÝHRADNĚ JSON v tomto schématu (žádný markdown, žádné komentáře, žádný úvod):

{
  "transcript": "...",
  "summary": "...",
  "key_themes": ["..."],
  "thoughts": [{"text": "...", "importance": "...", "rationale": "...", "category": "..."}],
  "open_questions": ["..."],
  "sentiment": "...",
  "intensity_signals": "..."
}`;

const BRIEF_PROMPT = (projectContext: string | null) => `Jsi senior analytik, který pomáhá Petrovi orientovat se v dlouhých projektových briefech. Audio ti pošlu jako vstup — typicky 30 až 90 minut hlavní postavy projektu, která vykládá kontext, historii, cíle, postupy.

${projectContext ? `Kontext projektu: ${projectContext}\n` : ""}
Tohle je BRIEF, ne krátký brain-dump. Zpracuj to do hloubky. Klidně si vezmi tolik výstupu, kolik je potřeba.

Tvoje úkoly:

1. **Doslovný přepis** (\`transcript\`) celého audia. Strukturovaný do odstavců, žádné zkrácení. Zachovej terminologii, kterou autor používá.

2. **Detailní souhrn** (\`summary\`) — klidně i přes 1000 slov, ale ne nafouklý. Strukturuj do nadpisů (volný markdown):
   - O čem projekt je
   - Kontext a historie
   - Klíčové postavy a role
   - Hlavní cíle / hypotézy
   - Aktuální stav a další kroky
   - Otevřené otázky
   - Petrovy poznámky pro orientaci (tj. „v této části autor zdůrazňuje X, klíčový bod je Y")

   Tohle je referenční materiál, ke kterému se Petr bude vracet — buď bohatý a věrný.

3. **Hlavní témata** (\`key_themes\`) — 5-10 výstižných pojmů.

4. **Konkrétní myšlenky** (\`thoughts\`) — vyextrahuj VŠECHNY důležité myšlenky (klidně 30+ pro 90min záznam). Pro každou stejné fields: \`text\`, \`importance\`, \`rationale\`, \`category\`.

5. **Otevřené otázky** (\`open_questions\`) — co je nedořešeno.

6. **Sentiment** + **intensity_signals** stejně jako u standardu.

7. **Glosář pojmů** (\`glossary\`) — termíny / zkratky / interní pojmy, které autor používá. Pro každý:
   - \`term\`: pojem
   - \`definition\`: jak ho autor používá / vysvětluje (nebo "není definováno v záznamu" pokud neexplicitní)

8. **Aktéři** (\`actors\`) — lidé, role, organizace, které autor zmínil. Pro každého:
   - \`name\`: jméno / označení
   - \`role\`: jeho role v projektu

9. **Historie rozhodnutí** (\`decision_history\`) — pole stringů, chronologicky co bylo rozhodnuto, kdy, proč.

Vrať VÝHRADNĚ JSON v rozšířeném schématu standardního s navíc \`glossary\`, \`actors\`, \`decision_history\`.`;

/**
 * Retry wrapper s exponential backoff.
 * Pokrývá transient errors: network blip, Gemini 5xx, rate limit.
 * Zpoždění: 1 s, 4 s. Po 3 pokusech to vzdá a hodí poslední error nahoru.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [0, 1000, 4000];
  let lastErr: unknown = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      console.log(`[audio-transcribe] retry ${label} attempt ${i + 1}/3 after ${delays[i]}ms`);
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Pokud je chyba "non-retryable" (špatný request, auth), vyhoď hned
      if (/INVALID_ARGUMENT|UNAUTHENTICATED|PERMISSION_DENIED|400|401|403/i.test(msg)) {
        throw e;
      }
      console.warn(`[audio-transcribe] ${label} attempt ${i + 1}/3 failed: ${msg.slice(0, 200)}`);
    }
  }
  throw lastErr;
}

function extractJson(text: string): string {
  // Gemini občas vrací JSON v markdown code-fence, i když říkáme „bez markdown".
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) return m[1].trim();
  }
  return trimmed;
}

// Inline audio limit. Vertex i AI Studio mají ~20 MB request size limit.
// Base64 inflation +33 %, takže 14 MB raw = ~19 MB v requestu — bezpečný strop.
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

export async function transcribeAudio(params: {
  audio: Buffer;
  mimeType: string;
  recordingType: RecordingTypeStr;
  projectContext?: string | null;
}): Promise<TranscribeResult> {
  const isBrief = params.recordingType === "BRIEF";
  const model = isBrief ? ANALYSIS_MODEL : DEFAULT_MODEL;

  // Načti prompty z DB override (s fallbackem na default v kódu).
  // Project context se připojuje runtime — Petr edituje jen instrukce.
  const basePrompt = await getPrompt(isBrief ? "studna-brief" : "studna-standard");
  const prompt = params.projectContext
    ? `${basePrompt}\n\nKontext projektu: ${params.projectContext}`
    : basePrompt;

  const fitsInline = params.audio.byteLength <= INLINE_AUDIO_LIMIT_BYTES;
  const mode = getGeminiMode();

  // Vyber klienta — Vertex pro inline (preferováno: EU + no-training),
  // AI Studio Files API pro velké soubory (Vertex by potřeboval GCS bucket).
  let genai = getGemini();
  let usedMode: "vertex" | "api" = mode === "vertex" ? "vertex" : "api";

  if (!fitsInline && mode === "vertex") {
    if (!env.GEMINI_API_KEY) {
      const sizeMb = (params.audio.byteLength / 1024 / 1024).toFixed(1);
      throw new Error(
        `Audio ${sizeMb} MB je nad ${INLINE_AUDIO_LIMIT_BYTES / 1024 / 1024} MB inline limit pro Vertex AI a GEMINI_API_KEY není v .env (fallback na AI Studio Files API tedy nelze). ` +
        `Buď doplň GEMINI_API_KEY do .env, rozsekni audio na kratší úseky, nebo zkomprimuj bitrate.`,
      );
    }
    // Fallback klient na AI Studio (samostatná instance, default zůstává Vertex)
    genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    usedMode = "api";
    console.log(`[audio-transcribe] Audio ${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB > ${INLINE_AUDIO_LIMIT_BYTES / 1024 / 1024} MB — fallback na AI Studio Files API.`);
  }

  // Připrav audio part
  let audioPart: { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };

  if (fitsInline) {
    audioPart = {
      inlineData: {
        mimeType: params.mimeType,
        data: params.audio.toString("base64"),
      },
    };
  } else {
    // Files API — pošli soubor (Blob), získej URI, reference v generateContent.
    const blob = new Blob([params.audio.buffer.slice(params.audio.byteOffset, params.audio.byteOffset + params.audio.byteLength) as ArrayBuffer], {
      type: params.mimeType,
    });
    const uploaded = await genai.files.upload({
      file: blob,
      config: { mimeType: params.mimeType },
    });
    if (!uploaded.uri || !uploaded.mimeType) {
      throw new Error("Gemini Files API: upload nevrátil uri/mimeType.");
    }
    // Počkej, až bude soubor ACTIVE (asynchronní processing, ~30-60 s pro hodinové audio)
    let file = uploaded;
    let attempts = 0;
    while (file.state !== "ACTIVE" && attempts < 120) {
      await new Promise((r) => setTimeout(r, 2000));
      file = await genai.files.get({ name: uploaded.name! });
      attempts++;
      if (file.state === "FAILED") {
        throw new Error("Gemini Files: zpracování souboru selhalo (server-side).");
      }
    }
    if (file.state !== "ACTIVE") {
      throw new Error("Gemini Files: timeout (>4 min) při čekání na zpracování souboru.");
    }
    audioPart = {
      fileData: { mimeType: file.mimeType!, fileUri: file.uri! },
    };
  }

  void usedMode; // pro budoucí logging/stats

  // -------------------------------------------------------------------------
  // STAGE 1: Pouhý přepis. Gemini dostane audio + minimální plain-text instrukci.
  // Vrátí prostý text, žádný JSON. Spolehlivé i pro dlouhé audio.
  // -------------------------------------------------------------------------
  // Načti Stage 1 prompt z DB override (fallback na default v ai-prompts.ts)
  const transcribePrompt = await getPrompt("ozvena-stage1-transcribe");

  const stage1Start = Date.now();
  const transcribeResp = await withRetry("Stage 1 (transcribe)", () =>
    genai.models.generateContent({
      model: DEFAULT_MODEL, // Flash je na přepis dostatečný i pro briefy (analýza je pak Pro)
      contents: [
        {
          role: "user",
          parts: [audioPart as never, { text: transcribePrompt }],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 65000, // pro 90 min audio reálně potřeba
      },
    }),
  );
  void trackGeminiCall({
    module: "audio-stage1-transcribe",
    response: transcribeResp,
    modelName: DEFAULT_MODEL,
    durationMs: Date.now() - stage1Start,
  });

  const transcript = (transcribeResp.text ?? "").trim();
  if (!transcript) {
    throw new Error(
      `Gemini Stage 1 (přepis) vrátil prázdný výstup. ` +
      `Audio: ${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB, mime ${params.mimeType}, mode ${usedMode}.`,
    );
  }

  // -------------------------------------------------------------------------
  // STAGE 2: Analýza nad přepisem. Žádné audio, jen text → spolehlivý JSON.
  // -------------------------------------------------------------------------
  const analyzePrompt = `Jsi senior asistent, který analyzuje přepis hlasového záznamu pro Petra. Audio už je přepsané — pracuj jen s textem.

${params.projectContext ? `Kontext projektu: ${params.projectContext}\n\n` : ""}Přepis:
"""
${transcript}
"""

${prompt}

Důležité: pole "transcript" v odpovědi neobsazuj — ten už mám. Naplň všechna ostatní pole. Vrať POUZE JSON.`;

  const stage2Start = Date.now();
  const analyzeResp = await withRetry("Stage 2 (analyze)", () =>
    genai.models.generateContent({
      model, // Flash pro STANDARD, Pro pro BRIEF
      contents: analyzePrompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: isBrief ? 32000 : 8000,
        responseMimeType: "application/json",
      },
    }),
  );
  void trackGeminiCall({
    module: "audio-stage2-analyze",
    response: analyzeResp,
    modelName: model,
    durationMs: Date.now() - stage2Start,
  });

  const rawAnalysis = (analyzeResp.text ?? "").trim();
  if (!rawAnalysis) {
    // Stage 2 selhal, ale přepis máme — vrať s minimální analýzou.
    return {
      transcript,
      analysis: minimalAnalysis(isBrief, "Stage 2 (analýza) vrátila prázdný výstup. Přepis je k dispozici, analýzu lze regenerovat."),
      model,
      promptChars: prompt.length,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(rawAnalysis));
  } catch (e) {
    return {
      transcript,
      analysis: minimalAnalysis(
        isBrief,
        `Stage 2 výstup není validní JSON: ${e instanceof Error ? e.message : String(e)}. Přepis je k dispozici. Surový output (200 znaků): ${rawAnalysis.slice(0, 200)}`,
      ),
      model,
      promptChars: prompt.length,
    };
  }

  const analysis: AudioAnalysis = {
    summary: parsed.summary ?? "",
    key_themes: Array.isArray(parsed.key_themes) ? parsed.key_themes : [],
    thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [],
    open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
    sentiment: parsed.sentiment ?? "neutral",
    intensity_signals: parsed.intensity_signals ?? "",
    ...(isBrief
      ? {
          glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
          actors: Array.isArray(parsed.actors) ? parsed.actors : [],
          decision_history: Array.isArray(parsed.decision_history) ? parsed.decision_history : [],
        }
      : {}),
  };

  return {
    transcript,
    analysis,
    model,
    promptChars: transcribePrompt.length + analyzePrompt.length,
  };
}

function minimalAnalysis(isBrief: boolean, note: string): AudioAnalysis {
  return {
    summary: `_${note}_`,
    key_themes: [],
    thoughts: [],
    open_questions: [],
    sentiment: "neutral",
    intensity_signals: "",
    ...(isBrief ? { glossary: [], actors: [], decision_history: [] } : {}),
  };
}
