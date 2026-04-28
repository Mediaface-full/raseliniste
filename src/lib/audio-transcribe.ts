/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGemini, getGeminiMode, DEFAULT_MODEL, ANALYSIS_MODEL } from "./gemini";

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
  const genai = getGemini();
  const isBrief = params.recordingType === "BRIEF";
  const model = isBrief ? ANALYSIS_MODEL : DEFAULT_MODEL;
  const prompt = isBrief
    ? BRIEF_PROMPT(params.projectContext ?? null)
    : STANDARD_PROMPT(params.projectContext ?? null);

  // Připrav audio part — buď inline (malé) nebo přes Files API (velké briefy)
  let audioPart: { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };

  if (params.audio.byteLength <= INLINE_AUDIO_LIMIT_BYTES) {
    audioPart = {
      inlineData: {
        mimeType: params.mimeType,
        data: params.audio.toString("base64"),
      },
    };
  } else if (getGeminiMode() === "vertex") {
    // Vertex AI nepodporuje genai.files.upload() — Files API existuje jen
    // v Google AI Studio módu. Pro Vertex by velké soubory šly přes GCS
    // bucket, což zatím nemáme nasazené.
    const sizeMb = (params.audio.byteLength / 1024 / 1024).toFixed(1);
    throw new Error(
      `Audio ${sizeMb} MB je nad limit ${INLINE_AUDIO_LIMIT_BYTES / 1024 / 1024} MB pro Vertex AI inline transcribe. ` +
      `Rozsekni záznam na kratší úseky (do ~13 minut MP3 / ~10 minut M4A) nebo zkomprimuj na nižší bitrate (32-48 kbps stačí pro řeč).`,
    );
  } else {
    // AI Studio mode — Files API funguje. Pošli soubor (Blob), získej URI.
    const blob = new Blob([params.audio.buffer.slice(params.audio.byteOffset, params.audio.byteOffset + params.audio.byteLength) as ArrayBuffer], {
      type: params.mimeType,
    });
    const uploaded = await genai.files.upload({
      file: blob,
      config: { mimeType: params.mimeType },
    });
    if (!uploaded.uri || !uploaded.mimeType) {
      throw new Error("Gemini Files API: upload neselhal nevrátil uri/mimeType.");
    }
    // Počkej, až bude soubor ACTIVE (Gemini Files má asynchronní processing)
    let file = uploaded;
    let attempts = 0;
    while (file.state !== "ACTIVE" && attempts < 60) {
      await new Promise((r) => setTimeout(r, 1500));
      file = await genai.files.get({ name: uploaded.name! });
      attempts++;
      if (file.state === "FAILED") {
        throw new Error("Gemini Files: zpracování souboru selhalo.");
      }
    }
    if (file.state !== "ACTIVE") {
      throw new Error("Gemini Files: timeout při čekání na zpracování souboru.");
    }
    audioPart = {
      fileData: { mimeType: file.mimeType!, fileUri: file.uri! },
    };
  }

  const response = await genai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [audioPart as never, { text: prompt }],
      },
    ],
    config: {
      temperature: 0.3,
      maxOutputTokens: isBrief ? 32000 : 8000,
      responseMimeType: "application/json",
    },
  });

  const raw = (response.text ?? "").trim();
  if (!raw) {
    throw new Error("Gemini vrátil prázdný výstup.");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (e) {
    throw new Error(
      `Gemini výstup není validní JSON: ${e instanceof Error ? e.message : String(e)}\n\nPrvních 500 znaků: ${raw.slice(0, 500)}`,
    );
  }

  if (typeof parsed.transcript !== "string") {
    throw new Error("Gemini výstup neobsahuje pole 'transcript'.");
  }

  // Defensivní defaulty (pokud Gemini něco vynechá)
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
    transcript: parsed.transcript,
    analysis,
    model,
    promptChars: prompt.length,
  };
}
