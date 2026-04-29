import { getGemini, DEFAULT_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

export type RedactedJournal = {
  cleanedText: string;
  hashtags: string[];
};

/**
 * System prompt pro AI redakci deníkového zápisu.
 *
 * Priority v tomto pořadí (důležité!):
 * 1. Zachovat význam, tón, osobnost autora
 * 2. Odstranit balast (koktání, "ehm", opakování, filler words)
 * 3. Opravit gramatiku a interpunkci
 * 4. Doplnit 3–5 hashtagů
 *
 * Gemini NESMÍ: přidávat informace, měnit fakta, přepisovat stylistiku,
 * dělat zápis formálnějším než byl, překládat nebo zkracovat.
 */
const SYSTEM_PROMPT = `Jsi profesionální editor osobních deníků. Tvým úkolem je šetrná redakce.

PRAVIDLA — v pořadí priority:

1. ZACHOVEJ TÓN A OSOBNOST. Pokud autor píše spontánně a hovorově, zůstaň
   hovorový. Pokud ironicky, zůstaň ironický. Nedělej text "hezčí" než je.

2. ODSTRAŇ BALAST:
   - koktání a opakování ("dneska, dneska jsem šel..." → "dneska jsem šel...")
   - filler words ("jakoby", "jaksi", "ehm", "prostě", "fakt",
     pokud NENÍ součást osobního stylu)
   - polovičaté věty a přeřeky

3. OPRAV GRAMATIKU A INTERPUNKCI.
   - velká písmena na začátku vět
   - čárky, tečky
   - shoda podmětu s přísudkem
   - překlepy

4. NEMĚNIT OBSAH.
   - nepřidávej informace
   - nepřepisuj metafory / konkrétní slova do obecnějších
   - nezkracuj jen aby byl text kratší

5. DOPLŇ 3–5 HASHTAGŮ bez diakritiky, v češtině, lowercase, jedno slovo
   nebo spojené (např. "tělo", "hudba", "matej", "zdravi", "reflexe",
   "nocvyspal", "firma"). Hashtagy reflektují O ČEM ten zápis je, ne co
   je v něm cítit.

Vrať VÝHRADNĚ validní JSON, žádný text kolem, žádné markdown bloky:

{
  "cleanedText": "string — redigovaný text zachovávající tón autora",
  "hashtags": ["string", "string"]
}`;

/**
 * Parse JSON s defenzivní validací. Gemini občas vrátí markdown fence.
 */
function parseResponse(raw: string): RedactedJournal | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;

    const cleanedText = typeof obj.cleanedText === "string" ? obj.cleanedText.trim() : "";
    const hashtagsRaw = obj.hashtags;
    const hashtags: string[] = Array.isArray(hashtagsRaw)
      ? hashtagsRaw
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) =>
            t
              .trim()
              .replace(/^#+/, "")
              .toLowerCase()
              .replace(/\s+/g, "-")
          )
          .filter((t) => t.length <= 40)
          .slice(0, 8)
      : [];

    if (cleanedText.length === 0) return null;
    return { cleanedText, hashtags };
  } catch {
    return null;
  }
}

/**
 * Zavolá Gemini Flash na redakci zápisu. Vrací null pokud selže
 * (caller použije raw text jako fallback).
 *
 * Latence: typicky 1.5-4 s pro krátký až střední zápis.
 */
export async function redactJournal(rawText: string): Promise<RedactedJournal | null> {
  try {
    const gemini = getGemini();
    const response = await callTracked({
      module: "journal-redact",
      modelName: DEFAULT_MODEL,
      fn: () => gemini.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{ role: "user", parts: [{ text: rawText }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });

    const text = response.text ?? "";
    if (!text) return null;
    return parseResponse(text);
  } catch (err) {
    console.error("[journal-redact] Gemini call failed:", err);
    return null;
  }
}
