/**
 * AI extrakce přípravy z popisu kalendářové události.
 *
 * Petr napíše do Google Calendar / iCloud popisu události zmínku typu
 * "vzít stan, spacák, baterku" nebo "připravit prezentaci, vytisknout smlouvy".
 * Tahle vrstva to vytáhne do `CalendarEvent.prepNote` (krátká shrnutí přípravy)
 * a `CalendarEvent.itemsToBring` (strukturovaný seznam věcí).
 *
 * Použití:
 *   const { prepNote, itemsToBring } = await extractCalendarPrep({
 *     title: "Výlet s Pepou",
 *     description: "Sraz v 8:00, vzít stan, spacák, kameru.",
 *   });
 *
 * Ranní briefing pak agreguje `itemsToBring` napříč zítřejšími události
 * do jednoho seznamu (`itemsToBringAggregate` v briefing-nightly).
 */

import { getGemini, DEFAULT_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

export interface CalendarPrep {
  prepNote: string | null;
  itemsToBring: string[];
}

const PROMPT = `Jsi asistent který vytahuje přípravu z popisu kalendářové události. Rozhoduj věcně, bez vaty.

VSTUP:
- title: název události
- description: popis (může obsahovat různé info, vytahuj jen relevantní k přípravě)

ÚKOL:
1. **prepNote** — krátká věta (max 100 znaků) shrnující co Petr potřebuje připravit nebo na co si dát pozor. Pokud z popisu nic relevantního, vrať null.
2. **itemsToBring** — pole konkrétních věcí které má vzít s sebou. Lower-case, krátké (1-3 slova). Příklad: ["stan", "spacák", "kamera"]. Pokud nic, vrať [].

PRAVIDLA:
- Češtinu zachovej.
- Žádné předměty co Petr má sám sebou (telefon, klíče, peněženka) — implicitní.
- Žádné general činnosti ("připravit se") — buď konkrétní nebo vynech.
- Ignoruj kontaktní info, adresy, časy — jen příprava + věci.

🇨🇿 JAZYK VÝSTUPU: čeština ve všech textech.

Vrať POUZE JSON v tomto tvaru, žádný markdown wrapper:
{
  "prepNote": "..." | null,
  "itemsToBring": ["...", "..."]
}`;

export async function extractCalendarPrep(opts: {
  title: string;
  description: string;
}): Promise<CalendarPrep> {
  const description = opts.description.trim();
  if (description.length === 0) return { prepNote: null, itemsToBring: [] };

  const userPart = `title: ${opts.title}\ndescription: ${description.slice(0, 4000)}`;
  const ai = getGemini();
  const response = await callTracked({
    module: "calendar-prep",
    modelName: DEFAULT_MODEL,
    fn: () => ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `${PROMPT}\n\n${userPart}`,
      config: {
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = (response.text ?? "").trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as any;
    const prepNote = typeof parsed.prepNote === "string" && parsed.prepNote.trim().length > 0
      ? parsed.prepNote.trim().slice(0, 200)
      : null;
    const itemsToBring = Array.isArray(parsed.itemsToBring)
      ? parsed.itemsToBring
          .filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x: string) => x.trim().toLowerCase().slice(0, 50))
          .slice(0, 30)
      : [];
    return { prepNote, itemsToBring };
  } catch {
    return { prepNote: null, itemsToBring: [] };
  }
}
