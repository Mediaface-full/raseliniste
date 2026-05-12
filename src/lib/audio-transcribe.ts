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

const STANDARD_PROMPT = (projectContext: string | null) => `Jsi asistent, který zpracovává hlasové záznamy projektového brainstormingu pro Gideona. Audio ti pošlu jako vstup.

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

const BRIEF_PROMPT = (projectContext: string | null) => `Jsi senior analytik, který pomáhá Gideonovi orientovat se v dlouhých projektových briefech. Audio ti pošlu jako vstup — typicky 30 až 90 minut hlavní postavy projektu, která vykládá kontext, historii, cíle, postupy.

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

/**
 * Detekce hallucination loopu v Gemini transcript output.
 *
 * Gemini 2.5 Flash u tichého/nečitelného audia občas spadne do smyčky a
 * opakuje krátkou frázi (např. „že se to stalo, že se to stalo, ...")
 * dokud nevyčerpá token limit. Výsledný transcript je k ničemu.
 *
 * Heuristika:
 *  1. Pokud text > 200 znaků a unikátnost slov < 8 % → loop
 *  2. Pokud 4-gramová fráze tvoří > 30 % textu → loop
 *
 * Vrací důvod (pro errorMessage), nebo null pokud je text v pořádku.
 */
function detectHallucinationLoop(text: string): string | null {
  if (text.length < 200) return null;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 40) return null;

  // (1) Unikátnost slov
  const unique = new Set(words);
  const ratio = unique.size / words.length;
  if (ratio < 0.08) {
    return `pouze ${unique.size}/${words.length} unikátních slov (${(ratio * 100).toFixed(1)} %)`;
  }

  // (2) 4-gramová repetice
  if (words.length >= 20) {
    const ngramCounts = new Map<string, number>();
    for (let i = 0; i <= words.length - 4; i++) {
      const ngram = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`;
      ngramCounts.set(ngram, (ngramCounts.get(ngram) ?? 0) + 1);
    }
    let maxNgram = "";
    let maxCount = 0;
    for (const [ngram, count] of ngramCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxNgram = ngram;
      }
    }
    const totalNgrams = words.length - 3;
    const ngramRatio = maxCount / totalNgrams;
    if (ngramRatio > 0.3) {
      return `fráze „${maxNgram}" opakována ${maxCount}× (${(ngramRatio * 100).toFixed(0)} % textu)`;
    }
  }

  return null;
}

function extractJson(text: string): string {
  // Gemini občas vrací JSON v markdown code-fence, i když říkáme „bez markdown".
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) trimmed = m[1].trim();
  }
  // Někdy je před/za JSON volný text — vyříznout od první { po poslední }.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    trimmed = trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/**
 * Pokus opravit truncated/malformed JSON od Gemini.
 * Časté chyby:
 *  - "Unterminated string in JSON" — výstup oříznutý uprostřed stringu (maxOutputTokens)
 *  - chybějící závěrečná závorka
 *
 * Strategie: postupně uzavírat unterminated stringy, zavírat otevřené [ { závorky.
 * Když parse stále selže, vrátí null.
 */
function tryRepairJson(raw: string): string | null {
  let s = raw;
  try { JSON.parse(s); return s; } catch {}

  // Najdi pozici syntaktické chyby a uřízni text před ní + uzavři otevřené struktury.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      JSON.parse(s);
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "Unterminated string in JSON at position N"
      const posMatch = msg.match(/position (\d+)/);
      if (!posMatch) break;
      const pos = parseInt(posMatch[1], 10);
      // Uřízni před chybnou pozicí, najdi poslední validní bod (čárku, } nebo ]).
      let cut = s.slice(0, pos);
      // Vrať se k poslední validní čárce nebo závorce
      const lastComma = cut.lastIndexOf(",");
      const lastClose = Math.max(cut.lastIndexOf("}"), cut.lastIndexOf("]"));
      const breakAt = Math.max(lastComma, lastClose);
      if (breakAt < 0) break;
      cut = cut.slice(0, breakAt);
      // Spočítej kolik je otevřených { a [
      let openCurly = 0, openSquare = 0, inString = false, escape = false;
      for (let i = 0; i < cut.length; i++) {
        const c = cut[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === "{") openCurly++;
        else if (c === "}") openCurly--;
        else if (c === "[") openSquare++;
        else if (c === "]") openSquare--;
      }
      // Doplň závěrečné závorky
      s = cut + "]".repeat(Math.max(0, openSquare)) + "}".repeat(Math.max(0, openCurly));
    }
  }
  try { JSON.parse(s); return s; } catch { return null; }
}

// Inline audio limit. Vertex i AI Studio mají ~20 MB request size limit.
// Base64 inflation +33 %, takže 14 MB raw = ~19 MB v requestu — bezpečný strop.
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

export async function transcribeAudio(params: {
  audio: Buffer;
  mimeType: string;
  recordingType: RecordingTypeStr;
  projectContext?: string | null;
  // Opt-in pro Studnu: očisti přepis od citoslovcí (ehm, eee, no, jakože, ...)
  // a zbytečných repetic. Zachová obsah a tón.
  // Default false — Ozvěna (deník/úkoly) zachovává doslovný přepis.
  cleanupFillers?: boolean;
  // Per-projekt override Stage 2 promptu (Studna/Prskavka). Pokud null/undefined,
  // použije se DB global override z /settings/ai-prompts, jinak default v kódu.
  customStandardPrompt?: string | null;
  customBriefPrompt?: string | null;
  // Per-projekt override Gemini modelu pro Stage 2. Pokud null/undefined,
  // použije se default: BRIEF=Pro, STANDARD=Flash.
  analysisModelOverride?: string | null;
}): Promise<TranscribeResult> {
  const isBrief = params.recordingType === "BRIEF";
  const model = (params.analysisModelOverride && params.analysisModelOverride.trim().length > 0)
    ? params.analysisModelOverride.trim()
    : (isBrief ? ANALYSIS_MODEL : DEFAULT_MODEL);

  // Priorita promptu: per-projekt override > DB global override > default v kódu.
  const customForType = isBrief ? params.customBriefPrompt : params.customStandardPrompt;
  const basePrompt = (customForType && customForType.trim().length > 0)
    ? customForType
    : await getPrompt(isBrief ? "studna-brief" : "studna-standard");
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
  // Načti Stage 1 prompt z DB override (fallback na default v ai-prompts.ts).
  // Pokud cleanupFillers=true (Studna), připoj instrukci o čištění výplňových slov.
  const baseTranscribePrompt = await getPrompt("ozvena-stage1-transcribe");
  // KRITICKÉ pravidlo přesnosti — Petr nahlásil že AI několikrát zaměnila
  // směr akce (kdo komu platil, kdo komu dal, kdo o koho pečuje). To je
  // diametrální chyba s reálnými následky. Prompt explicitně varuje a vyžaduje
  // doslovnost u subjekt/objekt.
  const accuracyRules = `

KRITICKÁ PRAVIDLA PŘESNOSTI (nesmíš porušit):
- Subjekt/objekt v každé větě dej **přesně tak, jak to mluvčí řekl**.
  Pokud řekne "platil jsem za něj" → napiš "platil jsem za něj", NIKDY
  "platil za mě". Stejně u "zavolal jsem mu" / "zavolal mi", "dal jsem ti" /
  "dal jsi mi", "pečuju o něj" / "pečuje o mě". Když si nejsi jistý kdo
  komu, napiš to **doslova jak slyšíš**, neopravuj domnělou logiku.
- Čísla, částky, data a jména osob přepiš **doslova**. Pokud jméno neslyšíš
  jasně, dej ho v hranatých závorkách s otazníkem např. [Mortyk?].
- "Pro" vs "od" / "za" vs "místo" — tyto předložky **NIKDY neměň**, mění smysl.
- Když je věta nejednoznačná, raději ji nech v původní (nejednoznačné) podobě
  než ji "opravit" do něčeho co měnitelně mění význam.`;
  const transcribePrompt = params.cleanupFillers
    ? `${baseTranscribePrompt}

DOPLŇUJÍCÍ PRAVIDLO PRO TENTO PŘEPIS:
- Vynech výplňová slova a citoslovce: "ehm", "eee", "uhm", "no", "jakože",
  "prostě", "vlastně" (pokud jsou jen výplňová), "víš", "no a", a podobné.
- Vynech bezprostřední repetice slov ("já já já jsem to..." → "já jsem to...",
  "no no no" → vypustit).
- Vynech nedokončené začátky vět které mluvčí přerušil a začal znovu.
- ZACHOVEJ obsah, tón a všechny věcné informace. Cílem je čitelný text,
  ne shrnutí.${accuracyRules}`
    : `${baseTranscribePrompt}${accuracyRules}`;

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

  // Detekce hallucination loopu — Gemini 2.5 Flash při tichém/nečitelném audiu
  // občas spadne do smyčky a opakuje krátkou frázi (např. „že se to stalo")
  // stovkykrát až do token limitu. Místo uložení blábolu raději error.
  const loopReason = detectHallucinationLoop(transcript);
  if (loopReason) {
    throw new Error(
      `Gemini transcription vrátila opakující se loop (${loopReason}). ` +
      `Pravděpodobně tiché/nečitelné audio. Audio: ${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB, mime ${params.mimeType}.`,
    );
  }

  // -------------------------------------------------------------------------
  // STAGE 2: Analýza nad přepisem. Žádné audio, jen text → spolehlivý JSON.
  // -------------------------------------------------------------------------
  const analyzePrompt = `Jsi senior asistent, který analyzuje přepis hlasového záznamu pro Gideona. Audio už je přepsané — pracuj jen s textem.

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
  const cleaned = extractJson(rawAnalysis);
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Gemini občas vrátí truncated/unterminated JSON (typicky narazil na maxOutputTokens).
    // Pokus opravit — odřízneme po poslední validní pozici a uzavřeme závorky.
    const repaired = tryRepairJson(cleaned);
    if (repaired) {
      try { parsed = JSON.parse(repaired); } catch {}
    }
    if (!parsed) {
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

/**
 * Stage 2 nad textovým přepisem (bez audia).
 *
 * Použití: admin (Petr) vloží do projektu hotový text místo nahrávky —
 * např. zápis schůzky který už má napsaný. Přeskočí Stage 1 (přepis),
 * provede jen Stage 2 (strukturovanou AI analýzu) nad daným textem.
 */
/**
 * Stage 1 only — pouze přepis audia, žádná AI analýza.
 *
 * Použití: UPLOAD recordings — host/admin nahraje hotový audio file (podcast,
 * zápis schůzky, audio knihu) a chce JEN doslovný text. Žádné cleanup
 * výplňových slov, žádné Stage 2 strukturovanou JSON analýzu.
 *
 * Vrací jen { transcript, model } — žádná `analysis` (volající ji uloží jako null).
 */
export async function transcribeAudioOnly(params: {
  audio: Buffer;
  mimeType: string;
  /** Volitelný kontext projektu — Gemini ho použije pro lepší rozpoznání jmen/termínů. */
  projectContext?: string | null;
}): Promise<{ transcript: string; model: string }> {
  const fitsInline = params.audio.byteLength <= INLINE_AUDIO_LIMIT_BYTES;
  const mode = getGeminiMode();
  let genai = getGemini();

  if (!fitsInline && mode === "vertex") {
    if (!env.GEMINI_API_KEY) {
      const sizeMb = (params.audio.byteLength / 1024 / 1024).toFixed(1);
      throw new Error(
        `Audio ${sizeMb} MB je nad ${INLINE_AUDIO_LIMIT_BYTES / 1024 / 1024} MB inline limit pro Vertex AI a GEMINI_API_KEY není v .env. ` +
        `Buď doplň GEMINI_API_KEY, rozsekni audio na kratší úseky, nebo zkomprimuj bitrate.`,
      );
    }
    genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  let audioPart: { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };

  if (fitsInline) {
    audioPart = {
      inlineData: { mimeType: params.mimeType, data: params.audio.toString("base64") },
    };
  } else {
    const blob = new Blob(
      [params.audio.buffer.slice(params.audio.byteOffset, params.audio.byteOffset + params.audio.byteLength) as ArrayBuffer],
      { type: params.mimeType },
    );
    const uploaded = await genai.files.upload({ file: blob, config: { mimeType: params.mimeType } });
    if (!uploaded.uri || !uploaded.mimeType) throw new Error("Gemini Files API: upload nevrátil uri/mimeType.");
    let file = uploaded;
    let attempts = 0;
    while (file.state !== "ACTIVE" && attempts < 120) {
      await new Promise((r) => setTimeout(r, 2000));
      file = await genai.files.get({ name: uploaded.name! });
      attempts++;
      if (file.state === "FAILED") throw new Error("Gemini Files: zpracování souboru selhalo.");
    }
    if (file.state !== "ACTIVE") throw new Error("Gemini Files: timeout (>4 min) při čekání na zpracování souboru.");
    audioPart = { fileData: { mimeType: file.mimeType!, fileUri: file.uri! } };
  }

  // Doslovný přepis bez cleanup — host může nahrát podcast/audio knihu/zápis
  // a chce přesný text. Plus kritická pravidla přesnosti subjekt/objekt.
  const prompt = `Přepiš toto audio do textu doslova.

PRAVIDLA:
- Doslovný přepis — zachovej všechna slova, čísla, jména osob.
- NEMĚŇ subjekt/objekt vět — pokud mluvčí řekne "platil jsem za něj", napiš to tak,
  NIKDY ne "platil za mě". Stejně u "dal jsem ti" / "dal jsi mi", "pečuju o něj" /
  "pečuje o mě". Předložky pro/od/za/místo NIKDY neměň, mění význam.
- Když je věta nejednoznačná, raději ji nech v původní podobě než ji "opravit"
  do něčeho, co měnitelně mění smysl.
- Pokud jméno neslyšíš jasně, dej ho v hranatých závorkách s otazníkem např. [Mortyk?].
- Odstavce po větších pauzách nebo změně tématu — ne uprostřed věty.
- Žádné komentáře, žádný markdown, žádný JSON. Jen přepis.

${params.projectContext ? `Kontext projektu (pro lepší rozpoznání jmen/termínů): ${params.projectContext}\n` : ""}`;

  const start = Date.now();
  const resp = await withRetry("UPLOAD transcribe", () =>
    genai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: "user", parts: [audioPart as never, { text: prompt }] }],
      config: { temperature: 0.1, maxOutputTokens: 65000 },
    }),
  );
  void trackGeminiCall({
    module: "audio-upload-transcribe",
    response: resp,
    modelName: DEFAULT_MODEL,
    durationMs: Date.now() - start,
  });

  const transcript = (resp.text ?? "").trim();
  if (!transcript) {
    throw new Error(
      `Gemini vrátil prázdný přepis. Audio: ${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB, mime ${params.mimeType}. ` +
      `Možná je nahrávka tichá nebo formát není podporovaný.`,
    );
  }

  return { transcript, model: DEFAULT_MODEL };
}

export async function analyzeTranscript(params: {
  transcript: string;
  recordingType: RecordingTypeStr;
  projectContext?: string | null;
  customStandardPrompt?: string | null;
  customBriefPrompt?: string | null;
  analysisModelOverride?: string | null;
}): Promise<TranscribeResult> {
  const isBrief = params.recordingType === "BRIEF";
  const model = (params.analysisModelOverride && params.analysisModelOverride.trim().length > 0)
    ? params.analysisModelOverride.trim()
    : (isBrief ? ANALYSIS_MODEL : DEFAULT_MODEL);

  const customForType = isBrief ? params.customBriefPrompt : params.customStandardPrompt;
  const basePrompt = (customForType && customForType.trim().length > 0)
    ? customForType
    : await getPrompt(isBrief ? "studna-brief" : "studna-standard");
  const prompt = params.projectContext
    ? `${basePrompt}\n\nKontext projektu: ${params.projectContext}`
    : basePrompt;

  const transcript = params.transcript.trim();
  if (!transcript) {
    throw new Error("Přepis je prázdný — není co analyzovat.");
  }

  const analyzePrompt = `Jsi senior asistent, který analyzuje přepis hlasového záznamu pro Gideona. Audio už je přepsané — pracuj jen s textem.

${params.projectContext ? `Kontext projektu: ${params.projectContext}\n\n` : ""}Přepis:
"""
${transcript}
"""

${prompt}

Důležité: pole "transcript" v odpovědi neobsazuj — ten už mám. Naplň všechna ostatní pole. Vrať POUZE JSON.`;

  const genai = getGemini();
  const stage2Start = Date.now();
  const analyzeResp = await withRetry("Stage 2 (analyze text-only)", () =>
    genai.models.generateContent({
      model,
      contents: analyzePrompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: isBrief ? 32000 : 8000,
        responseMimeType: "application/json",
      },
    }),
  );
  void trackGeminiCall({
    module: "audio-stage2-analyze-text-only",
    response: analyzeResp,
    modelName: model,
    durationMs: Date.now() - stage2Start,
  });

  const rawAnalysis = (analyzeResp.text ?? "").trim();
  if (!rawAnalysis) {
    return {
      transcript,
      analysis: minimalAnalysis(isBrief, "Stage 2 vrátila prázdný výstup. Přepis je k dispozici, analýzu lze regenerovat."),
      model,
      promptChars: prompt.length,
    };
  }

  let parsed: any;
  const cleaned2 = extractJson(rawAnalysis);
  try {
    parsed = JSON.parse(cleaned2);
  } catch (e) {
    const repaired = tryRepairJson(cleaned2);
    if (repaired) {
      try { parsed = JSON.parse(repaired); } catch {}
    }
    if (!parsed) {
      return {
        transcript,
        analysis: minimalAnalysis(
          isBrief,
          `Stage 2 výstup není validní JSON: ${e instanceof Error ? e.message : String(e)}. Přepis je k dispozici.`,
        ),
        model,
        promptChars: prompt.length,
      };
    }
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
    promptChars: analyzePrompt.length,
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
