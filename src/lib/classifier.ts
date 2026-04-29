import { getGemini, FAST_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

export type ClassifiedEntry = {
  type: "TASK" | "JOURNAL" | "THOUGHT" | "CONTEXT" | "KNOWLEDGE";
  text: string;
  rawExcerpt: string | null;
  suggestedProject: string | null;
  suggestedWhen: "TODAY" | "THIS_WEEK" | "SOMEDAY" | null;
  rationale: string | null;
  knowledgeCategory: string | null;
  knowledgeUrl: string | null;
  knowledgeTags: string[];
};

const SYSTEM_PROMPT = `Jsi asistent uživatele, který si diktuje myšlenky, úkoly, poznatky
a poznámky do osobního systému jménem Rašeliniště.

Tvým úkolem je rozdělit mluvený vstup (po transkripci) na samostatné
smysluplné položky a každou klasifikovat.

Typy položek:

TASK — jasně definovaná akce, kterou má někdo provést. Musí mít
  sloveso a dostatečnou specificitu, aby byla proveditelná.

JOURNAL — zápis o prožitku, pocitu, denním dění. Reflexe toho,
  co bylo, ne plán toho, co bude.

THOUGHT — myšlenka, nápad, úvaha. Ještě ne úkol, jen materiál
  k přemýšlení. Pocit "měl bych", "jednou bych chtěl" bez konkrétní
  akce spadá sem.

CONTEXT — faktická informace o člověku, projektu nebo situaci,
  kterou stojí za to si zapamatovat pro pozdější použití při
  komunikaci nebo rozhodování.

KNOWLEDGE — zdroj, odkaz, kurz, škola, technika, tutoriál, kniha,
  článek, video, nástroj nebo téma, které uživatel chce mít
  k dispozici jako referenci. Nic se u KNOWLEDGE neodškrtává — je
  to materiál, ke kterému se vrací. Pokud uživatel mluví o něčem,
  co objevil, co ho zaujalo, co si chce pustit nebo přečíst, je to
  KNOWLEDGE, ne TASK.

Uživatelovy aktivní projekty s vlastní vážností:
- Hudba (vysoká priorita — uživatel se rozhodl, že hudba je projekt,
  chce vydat desku, má 12 kytar)
- Tělo (zdraví, sport, spánek, jídlo)
- Syn / Matěj (vše týkající se jeho 11letého syna — v Todoistu
  pod projektem 'Matěj')
- Firma (práce, klienti, kolegové)
- Rašeliniště (vývoj tohoto systému)
- Osobní (administrativa, občanka, účty)
- Domácnost (bydlení, praktické věci)
- Lidé (volání, návštěvy, udržování kontaktů — mimo práci)
- Prodej (věci, co uživatel prodává)

Pravidla rozlišování:

1. Pokud uživatel říká akci, která spadá do jednoho z aktivních
   projektů → TASK.
   Příklad: "Nacvičit Travis picking" → TASK, projekt Hudba.

2. Pokud uživatel mluví o zdroji, kurzu, škole, odkazu, technice,
   ať už spadá do aktivního projektu, nebo ne → KNOWLEDGE.
   Příklad: "Našel jsem online kurz fingerstyle kytary od Tommy
   Emmanuela" → KNOWLEDGE, kategorie Hudba.
   Příklad: "Zajímavý článek o trauma-informed therapy"
   → KNOWLEDGE, kategorie Psychologie.

3. Pokud uživatel vyjadřuje zájem, zvědavost, "chtěl bych vědět",
   "jednou bych se chtěl naučit", bez konkrétní akce nebo zdroje
   → THOUGHT.
   Příklad: "Rád bych se někdy naučil španělsky" → THOUGHT.

4. Rozdíl TASK vs KNOWLEDGE u stejného tématu:
   - "Nastuduj Multisite WordPress" → TASK jen pokud je to pro
     konkrétní projekt s termínem.
   - "Narazil jsem na dobrý tutoriál Multisite WordPress"
     → KNOWLEDGE, kategorie Technické.

   Když si nejsi jistý, ptej se: má to konkrétní výstup a termín?
   Pak TASK. Nemá? Pak KNOWLEDGE nebo THOUGHT.

5. Při pochybnostech mezi TASK a THOUGHT volb THOUGHT.
   Při pochybnostech mezi TASK a KNOWLEDGE volb KNOWLEDGE.

6. Jedna nahrávka může obsahovat 0 až N položek různých typů.

7. Nerozděluj násilně — pokud uživatel mluví o jedné věci 3 minuty,
   může to být jedna položka.

8. Nevymýšlej informace, které uživatel neřekl.

9. "text" = učesaný text bez koktání, opakování, filler words.
   Zachovávej význam a tón.

10. "rawExcerpt" = krátká citace z původního vstupu, ze které
    položka vznikla (pro uživatelovu kontrolu).

Pro TASK navíc:
- suggestedProject: "Osobní" | "Tělo" | "Matěj" | "Syn" | "Firma" |
  "Hudba" | "Rašeliniště" | "Domácnost" | "Lidé" | "Prodej" | null
  (pro syna preferuj "Matěj" — to je název projektu v Todoistu;
   "Syn" akceptuj taky, ale ve výstupu dávej "Matěj")
- suggestedWhen: "TODAY" | "THIS_WEEK" | "SOMEDAY" | null
- rationale: jedna věta proč jsi navrhl tyto hodnoty

Pro KNOWLEDGE navíc:
- knowledgeCategory: "Hudba" | "Psychologie" | "AI" | "Technické" |
  "Obchod" | "Zdraví" | "Ostatní" (nebo jiná odvozená z kontextu)
- knowledgeUrl: pokud uživatel zmínil URL nebo název platformy
- knowledgeTags: 1–5 krátkých tagů pro vyhledávání (např.
  ["fingerstyle", "Tommy Emmanuel", "tutoriál"])

Vrať VÝHRADNĚ validní JSON, žádný text kolem, žádné markdown bloky:

{
  "entries": [
    {
      "type": "TASK" | "JOURNAL" | "THOUGHT" | "CONTEXT" | "KNOWLEDGE",
      "text": "string",
      "rawExcerpt": "string",
      "suggestedProject": "string | null",
      "suggestedWhen": "TODAY | THIS_WEEK | SOMEDAY | null",
      "rationale": "string | null",
      "knowledgeCategory": "string | null",
      "knowledgeUrl": "string | null",
      "knowledgeTags": ["string"] | null
    }
  ]
}`;

const VALID_TYPES = new Set(["TASK", "JOURNAL", "THOUGHT", "CONTEXT", "KNOWLEDGE"]);
const VALID_WHENS = new Set(["TODAY", "THIS_WEEK", "SOMEDAY"]);

function parseAndValidate(raw: string): ClassifiedEntry[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini nevrátila validní JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) {
    throw new Error("Gemini JSON nemá pole 'entries'");
  }
  const arr = (parsed as { entries: unknown }).entries;
  if (!Array.isArray(arr)) throw new Error("'entries' není pole");

  const out: ClassifiedEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;

    const type = String(e.type ?? "").toUpperCase();
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!VALID_TYPES.has(type) || text.length === 0) continue;

    const when = e.suggestedWhen == null ? null : String(e.suggestedWhen).toUpperCase();

    const rawTags = e.knowledgeTags;
    const knowledgeTags: string[] = Array.isArray(rawTags)
      ? rawTags
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 10) // ochrana
      : [];

    out.push({
      type: type as ClassifiedEntry["type"],
      text,
      rawExcerpt: typeof e.rawExcerpt === "string" ? e.rawExcerpt : null,
      suggestedProject:
        typeof e.suggestedProject === "string" && e.suggestedProject.trim().length > 0
          ? e.suggestedProject.trim()
          : null,
      suggestedWhen: when && VALID_WHENS.has(when) ? (when as ClassifiedEntry["suggestedWhen"]) : null,
      rationale: typeof e.rationale === "string" ? e.rationale : null,
      knowledgeCategory:
        typeof e.knowledgeCategory === "string" && e.knowledgeCategory.trim().length > 0
          ? e.knowledgeCategory.trim()
          : null,
      knowledgeUrl:
        typeof e.knowledgeUrl === "string" && e.knowledgeUrl.trim().length > 0
          ? e.knowledgeUrl.trim()
          : null,
      knowledgeTags,
    });
  }

  return out;
}

export async function classify(rawText: string): Promise<ClassifiedEntry[]> {
  const gemini = getGemini();
  const response = await callTracked({
    module: "capture-classifier",
    modelName: FAST_MODEL,
    fn: () => gemini.models.generateContent({
      model: FAST_MODEL,
      contents: [{ role: "user", parts: [{ text: rawText }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    }),
  });

  const text = response.text ?? "";
  if (!text) throw new Error("Gemini vrátila prázdnou odpověď");
  return parseAndValidate(text);
}
