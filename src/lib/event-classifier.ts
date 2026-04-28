/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGemini, DEFAULT_MODEL } from "./gemini";

/**
 * Vertex Flash classifier — určí EventType podle titulu, popisu, lokace.
 * Stejný EventType jako v Prisma enum.
 *
 * V paměti cache podle hash(title+location) — TTL nepřítomný (resetuje se
 * restartem kontejneru, což je OK).
 */

export type EventTypeStr =
  | "MEETING_PRAGUE"
  | "MEETING_HOME"
  | "MEETING_ELSEWHERE"
  | "MEETING_ONLINE"
  | "PERSONAL"
  | "HOCKEY_SON"
  | "PARTNER_SHIFT"
  | "PARTNER_VACATION"
  | "OOO_FULL"
  | "OOO_TRAVEL_WORKING"
  | "OTHER";

const cache = new Map<string, EventTypeStr>();

function cacheKey(title: string, locationText: string | null, source: string): string {
  return `${source}|${title.toLowerCase().trim()}|${(locationText ?? "").toLowerCase().trim()}`;
}

// ---------------------------------------------------------------------------
// Heuristické pre-filtry — rychlejší a deterministické než AI volání
// ---------------------------------------------------------------------------

const HOCKEY_RE = /(hokej|trénink|trenink|zimní stadion|zs |zvíkov|stadion)/i;
const SHIFT_RE = /^(NOCNI|DENNI|nocni|denni|noční|denní)\b/i;
const VACATION_RE = /(dovolená|vacation|pryč|🌴|🏖️)/i;
const NOMAD_RE = /(nomád|nomad|working remote|pracuju z|pracuji z)/i;
const ONLINE_RE = /\b(zoom|meet|teams|hangout|call|online|video|webinář|webinar)\b/i;

export interface ClassifyInput {
  title: string;
  description?: string | null;
  locationText?: string | null;
  allDay: boolean;
  source: "GOOGLE_PRIMARY" | "ICLOUD_SON" | "ICLOUD_PARTNER" | "RASELINISTE";
}

export async function classifyEvent(input: ClassifyInput): Promise<EventTypeStr> {
  // Source-driven hard rules
  if (input.source === "ICLOUD_SON") {
    if (HOCKEY_RE.test(input.title)) return "HOCKEY_SON";
    return "PERSONAL";
  }
  if (input.source === "ICLOUD_PARTNER") {
    if (input.allDay && VACATION_RE.test(input.title)) return "PARTNER_VACATION";
    if (SHIFT_RE.test(input.title)) return "PARTNER_SHIFT";
    return "PERSONAL";
  }

  // Google-primary heuristics
  if (input.allDay && VACATION_RE.test(input.title)) return "OOO_FULL";
  if (input.allDay && NOMAD_RE.test(input.title)) return "OOO_TRAVEL_WORKING";

  // Cache check
  const key = cacheKey(input.title, input.locationText ?? null, input.source);
  const cached = cache.get(key);
  if (cached) return cached;

  // Heuristika online
  const text = `${input.title} ${input.description ?? ""} ${input.locationText ?? ""}`;
  if (ONLINE_RE.test(text) && !input.locationText?.match(/Praha|Plzeň|Brno|Studená/i)) {
    cache.set(key, "MEETING_ONLINE");
    return "MEETING_ONLINE";
  }

  // Lokace-driven hint
  if (input.locationText) {
    const loc = input.locationText.toLowerCase();
    if (/praha|prague|smíchov|vinohrady|karlín|žižkov/i.test(loc)) {
      cache.set(key, "MEETING_PRAGUE");
      return "MEETING_PRAGUE";
    }
    if (/jílové|studená|domů|home/i.test(loc)) {
      cache.set(key, "MEETING_HOME");
      return "MEETING_HOME";
    }
    if (/plzeň|brno|ostrava|olomouc/i.test(loc)) {
      cache.set(key, "MEETING_ELSEWHERE");
      return "MEETING_ELSEWHERE";
    }
  }

  // AI fallback (jen když heuristika nezabrala)
  try {
    const result = await classifyWithAI(input);
    cache.set(key, result);
    return result;
  } catch {
    return "OTHER";
  }
}

async function classifyWithAI(input: ClassifyInput): Promise<EventTypeStr> {
  const genai = getGemini();
  const prompt = `Klasifikuj typ kalendářní události. Vrať POUZE jeden z následujících kódů:
- MEETING_PRAGUE: prezenční schůzka v Praze
- MEETING_HOME: prezenční schůzka u Petra doma (Jílové u Prahy / Studená 9)
- MEETING_ELSEWHERE: prezenční schůzka jinde (Plzeň, Brno, atd.)
- MEETING_ONLINE: online (Zoom, Meet, Teams, video call)
- PERSONAL: soukromé (volno, rodina, koníček, nespadá do bookingů)
- OOO_FULL: dovolená (vše blokované)
- OOO_TRAVEL_WORKING: nomád (jen prezenční blokované)
- OTHER: nelze zařadit

Vstup:
Název: ${input.title}
Popis: ${input.description ?? "(žádný)"}
Lokace: ${input.locationText ?? "(žádná)"}
Celodenní: ${input.allDay ? "ano" : "ne"}

Vrať pouze kód, žádný text navíc.`;

  const response = await genai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config: { temperature: 0, maxOutputTokens: 30 },
  });

  const text = (response.text ?? "").trim().toUpperCase();
  const valid: EventTypeStr[] = [
    "MEETING_PRAGUE",
    "MEETING_HOME",
    "MEETING_ELSEWHERE",
    "MEETING_ONLINE",
    "PERSONAL",
    "OOO_FULL",
    "OOO_TRAVEL_WORKING",
    "OTHER",
  ];
  for (const v of valid) {
    if (text.includes(v)) return v;
  }
  return "OTHER";
}

export function clearClassifierCache(): void {
  cache.clear();
}
