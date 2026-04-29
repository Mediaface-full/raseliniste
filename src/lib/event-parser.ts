import { getGemini, DEFAULT_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import type { EventTypeStr } from "./event-classifier";

/**
 * Parser českého volného textu / hlasového diktátu na strukturovanou
 * kalendářní událost. Vrací null pokud chybí lokace nebo čas
 * (UI dotáhne `needsClarification`).
 *
 * Typický input:
 *   "úterý v 11 ČSOB Praha"
 *   "zítra v 9 schůzka u Karla doma"
 *   "online call s Janou pondělí 10"
 *   "13.5. 16:00 ČSOB"
 */

export interface ParsedEvent {
  title: string;
  type: EventTypeStr;
  locationName: string | null;
  startsAt: string;     // ISO 8601
  endsAt: string;       // ISO 8601
  confidence: number;   // 0–1
  description?: string | null;
}

export interface ParseResult {
  parsed: ParsedEvent | null;
  needsClarification: string | null;
}

export async function parseEventText(freeText: string, now: Date = new Date()): Promise<ParseResult> {
  const trimmed = freeText.trim();
  if (!trimmed) {
    return { parsed: null, needsClarification: "Napiš co a kdy. Např. „úterý 11 ČSOB Praha“." };
  }

  const today = now.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isoNow = now.toISOString();

  const prompt = `Jsi parser českých kalendářních zápisů. Vrať JEDEN JSON objekt s těmito poli:
{
  "title": string                     // krátký výstižný název (max 50 znaků)
  "type": "MEETING_PRAGUE" | "MEETING_HOME" | "MEETING_ELSEWHERE" | "MEETING_ONLINE" | "PERSONAL" | "OTHER",
  "locationName": string | null,      // "Praha", "doma", "Plzeň", "online", null
  "startsAt": ISO 8601 string,        // s časovou zónou Europe/Prague (+01:00 / +02:00 podle DST)
  "endsAt": ISO 8601 string,          // default 60 minut po startu
  "confidence": number,                // 0.0–1.0 (pokud chybí lokace nebo čas, dej < 0.6)
  "description": string | null,       // doplňkový kontext z textu
  "needsClarification": string | null // pokud parser tápe, krátká česká otázka pro uživatele; jinak null
}

Pravidla:
- Pokud uživatel řekne "Praha" → MEETING_PRAGUE.
- Pokud "doma" / "u mě" / "u nás" → MEETING_HOME.
- Pokud "Plzeň", "Brno", jiné město → MEETING_ELSEWHERE.
- Pokud "online", "Zoom", "Meet", "Teams", "video", "call" bez města → MEETING_ONLINE.
- Pokud chybí lokace, vrať needsClarification "Řekni místo: Praha, doma, online, nebo jiné město.".
- Pokud chybí konkrétní čas (jen "ráno", "odpoledne"), vrať needsClarification "Řekni přesný čas, prosím.".
- Defaultní délka schůzky 60 minut, pokud uživatel neřekne jinak.
- "úterý/středa/...": nejbližší budoucí daný den.
- "zítra" / "dnes": doslovně.
- Datum jako "13.5." → 13. května aktuálního roku (nebo příští, pokud datum už proběhlo).
- Konkrétní čas: 8:00 = 08:00:00, "v 11" = 11:00:00.
- Časová zóna VŽDY Europe/Prague.

Aktuální čas: ${isoNow}
Aktuální den: ${today}

Vstup uživatele:
"""
${trimmed}
"""

Vrať POUZE jeden JSON objekt, žádný markdown, žádný další text.`;

  try {
    const genai = getGemini();
    const response = await callTracked({
      module: "event-parser",
      modelName: DEFAULT_MODEL,
      fn: () => genai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
        },
      }),
    });

    const text = (response.text ?? "").trim();
    const obj = JSON.parse(text);

    if (obj.needsClarification && (!obj.startsAt || !obj.locationName)) {
      return { parsed: null, needsClarification: String(obj.needsClarification) };
    }

    if (!obj.startsAt || !obj.endsAt || !obj.title) {
      return { parsed: null, needsClarification: "Nevím — zkus to říct jinak." };
    }

    const parsed: ParsedEvent = {
      title: String(obj.title).slice(0, 100),
      type: normalizeType(obj.type),
      locationName: obj.locationName ?? null,
      startsAt: String(obj.startsAt),
      endsAt: String(obj.endsAt),
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0.6,
      description: obj.description ?? null,
    };

    // Pokud confidence < 0.5, ber jako needsClarification
    if (parsed.confidence < 0.5) {
      return {
        parsed,
        needsClarification: obj.needsClarification ?? "Nejsem si jistý — zkontroluj parsování.",
      };
    }

    return { parsed, needsClarification: obj.needsClarification ?? null };
  } catch (e) {
    return {
      parsed: null,
      needsClarification: `Parser selhal: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function normalizeType(t: unknown): EventTypeStr {
  const valid: EventTypeStr[] = [
    "MEETING_PRAGUE", "MEETING_HOME", "MEETING_ELSEWHERE", "MEETING_ONLINE",
    "PERSONAL", "OTHER",
  ];
  if (typeof t === "string" && valid.includes(t as EventTypeStr)) return t as EventTypeStr;
  return "OTHER";
}
