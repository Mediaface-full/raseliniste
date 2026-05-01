/**
 * AI vrstva pro B&W Myš modul.
 *
 * 4 šablony promptů (dle PDF zadání):
 *   1. Návrh dalších variant (Tok 1) — pokud uživatel zadal jen 2 varianty
 *   2. Mini-vyhodnocení (Tok 3) — středně velký prompt, "zrcadlo, ne rozhodnutí"
 *   3. Finální vyhodnocení (Tok 4) — velký prompt, výstup ve fixních sekcích A-H
 *   4. Klasifikace úhlu pohledu — interní subprocess pokud entry má uhelPohledu="nevybrano"
 *
 * Tón VÝSTUPU: věcný, argumentační, strukturovaný. ŽÁDNÝ terapeutický tón.
 *   - NE: "vidím že tě to trápí", "to je opravdu těžké"
 *   - ANO: "Z 8 zápisů 6 obsahuje rizika finanční. Hlavní opakující se motiv: …"
 */

import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface DecisionForAi {
  nazev: string;
  kontext: "pracovni" | "osobni" | "smiseny";
  otazka: string;
  varianty: string[];
  predpoklady: string[];
  deadlineRozhodnuti: Date;
  delkaSberuDny: number;
}

export interface EntryForAi {
  datum: Date;
  nalada: number;
  typVstupu: string;
  uhelPohledu: string;
  obsah: string;
}

// ---------------------------------------------------------------------------
// 1. Návrh dalších variant (krátký prompt)
// ---------------------------------------------------------------------------

export async function navrhniDalsiVarianty(otazka: string, soucasneVarianty: string[]): Promise<string[]> {
  const prompt = `Uživatel zadal pouze tyto varianty pro otázku "${otazka}":
${soucasneVarianty.map((v, i) => `${i + 1}. ${v}`).join("\n")}

Navrhni 2-3 další realistické varianty, které uživatele typicky míjejí (např. menší verze, odložení, delegování, ne-akce, hybridní řešení). Drž věcný tón, žádné komentáře k výběru.

Vrať POUZE JSON pole stringů, bez markdownu:
["varianta 1", "varianta 2", "varianta 3"]`;

  const ai = getGemini();
  const start = Date.now();
  const response = await callTracked({
    module: "bwmys-varianty",
    modelName: ANALYSIS_MODEL,
    fn: () => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.5, maxOutputTokens: 500, responseMimeType: "application/json" },
    }),
  });
  void start;

  const raw = (response.text ?? "").trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string" && s.length > 0).slice(0, 5);
  } catch {
    // fallback — pokus o extrakci řádků
    return raw.split("\n").filter((l) => l.trim().length > 5).slice(0, 5);
  }
  return [];
}

// ---------------------------------------------------------------------------
// 2. Mini-vyhodnocení / průběžné (Tok 3)
// ---------------------------------------------------------------------------

export interface MiniEvaluation {
  rozlozeniNalad: string;        // "Z 6 zápisů: 2× nálada 5, 3× nálada 3, 1× nálada 1"
  opakujiciSeMotivy: string[];   // 2-5 bullets
  chybejiciUhly: string[];        // co v zápisech NENÍ (např. "fakta", "alternativy")
  poznamka: string;               // celkové meta — JE TO ZRCADLO, NE ROZHODNUTÍ
}

export async function miniVyhodnoceni(d: DecisionForAi, entries: EntryForAi[]): Promise<MiniEvaluation> {
  const prompt = `Jsi asistent pro strukturované rozhodování. Toto je PRŮBĚŽNÉ vyhodnocení — NE finální verdikt. Cílem je ZRCADLO, ne rozhodnutí.

ROZHODNUTÍ:
- Otázka: ${d.otazka}
- Kontext: ${d.kontext}
- Varianty: ${d.varianty.map((v, i) => `${i + 1}. ${v}`).join("; ")}
- Předpoklady: ${d.predpoklady.join("; ")}

ZÁPISY (${entries.length}):
${entries.map((e, i) => `[${i + 1}] ${e.datum.toLocaleDateString("cs-CZ")} · nálada ${e.nalada}/5 · ${e.typVstupu} · ${e.uhelPohledu}\n${e.obsah}`).join("\n\n")}

ÚKOL: Ukaž zatím viditelné vzorce. NE doporučení.

Vrať POUZE JSON tohoto tvaru:
{
  "rozlozeniNalad": "stručné shrnutí jak je rozloženo (např. 'Z 6 zápisů: 4× nálada 4-5, 2× nálada 1-2')",
  "opakujiciSeMotivy": ["motiv 1", "motiv 2", "motiv 3"],
  "chybejiciUhly": ["co v zápisech není — např. 'fakta', 'finanční pohled', 'alternativy'"],
  "poznamka": "1-2 věty co stojí za pozornost. Bez doporučení. Bez terapeutického tónu."
}`;

  const ai = getGemini();
  const response = await callTracked({
    module: "bwmys-mini",
    modelName: ANALYSIS_MODEL,
    fn: () => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.3, maxOutputTokens: 2000, responseMimeType: "application/json" },
    }),
  });

  const raw = (response.text ?? "").trim();
  try {
    return JSON.parse(raw) as MiniEvaluation;
  } catch (e) {
    throw new Error(`Mini-vyhodnocení: nelze parse JSON. Prvních 200 znaků: ${raw.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Finální vyhodnocení (Tok 4) — sekce A-H
// ---------------------------------------------------------------------------

export interface FinalniEvaluation {
  A_statistika: {
    pocetZapisu: number;
    rozsahDni: number;
    distribuceNalad: string;          // např. "1: 0×, 2: 1×, 3: 4×, 4: 2×, 5: 1×"
    distribuceTypu: string;           // přehled typVstupu
    upozorneni: string | null;        // pokud vzorek slabý/nevyvážený
  };
  B_sixHats: {
    bily_fakta: string[];             // 2-4 odrážky
    cerveny_emoce: string[];
    cerny_rizika: string[];
    zluty_prinosy: string[];
    zeleny_alternativy: string[];
    modry_meta: string[];
  };
  C_signalSum: {
    konzistentniSignaly: string[];    // co se opakuje napříč náladami
    naladoveSkrelene: string[];        // co je řečeno jen v určité náladě
    recyklovaneUvahy: string[];        // co se točí dokola bez nových informací
  };
  D_preMortem: {
    horizont: string;                  // "Je rok X+1, rozhodnutí selhalo."
    duvody: string[];                  // 5 nejpravděpodobnějších důvodů
  };
  E_horizon10: {
    za10Minut: string;
    za10Mesicu: string;
    za10Let: string;
  };
  F_wrapCheck: {
    realneViceVariant: string;         // ano/ne + komentář
    otestovanePredpoklady: string;
    dostatecnyOdstup: string;
    planB: string;
  };
  G_kriteria: {
    pracovni?: {
      obchodni: string;
      financni: string;
      marketingovy: string;
      narocnostRealizace: string;
      strategickyFit: string;
    };
    osobni?: {
      souladSHodnotami: string;
      vlivNaVztahy: string;
      vlivNaCasAEnergii: string;
      reverzibilita: string;
      souladSeZivotniFazi: string;
    };
  };
  H_verdikt: {
    doporuceni: string;
    hlavniArgumentPro: string;
    hlavniArgumentProti: string;
    coByPreklopilo: string;
    doporuceneDatumRevize: string;     // ISO YYYY-MM-DD
  };
}

export async function finalniVyhodnoceni(d: DecisionForAi, entries: EntryForAi[]): Promise<FinalniEvaluation> {
  const kontextInstruktura = d.kontext === "pracovni"
    ? "Pro PRACOVNÍ kontext vyplň G.pracovni (obchodní/finanční/marketingový/náročnost realizace/strategický fit). G.osobni neexistuje."
    : d.kontext === "osobni"
      ? "Pro OSOBNÍ kontext vyplň G.osobni (soulad s hodnotami/vliv na vztahy/vliv na čas a energii/reverzibilita/soulad s životní fází). G.pracovni neexistuje."
      : "Pro SMÍŠENÝ kontext vyplň OBA bloky G.pracovni i G.osobni.";

  const prompt = `Jsi asistent pro strukturované rozhodování. Toto je FINÁLNÍ vyhodnocení.

PRAVIDLA TÓNU (nesmíš porušit):
- Věcný, argumentační, strukturovaný tón.
- ŽÁDNÝ terapeutický jazyk ("vidím že tě to trápí", "rozumím tvojí situaci").
- Emoce zpracuj jako data, ne jako téma.
- Doporučení dej s odůvodněním. Nezvolíš za uživatele — jen argumentuješ.

ROZHODNUTÍ:
- Název: ${d.nazev}
- Kontext: ${d.kontext}
- Otázka: ${d.otazka}
- Varianty: ${d.varianty.map((v, i) => `${i + 1}. ${v}`).join("; ")}
- Předpoklady: ${d.predpoklady.join("; ")}
- Deadline: ${d.deadlineRozhodnuti.toLocaleDateString("cs-CZ")}

ZÁPISY (${entries.length}, chronologicky):
${entries.map((e, i) => `[${i + 1}] ${e.datum.toLocaleDateString("cs-CZ")} | nálada ${e.nalada}/5 | ${e.typVstupu} | úhel: ${e.uhelPohledu}\n${e.obsah}`).join("\n\n")}

${kontextInstruktura}

Vrať POUZE JSON tohoto tvaru (žádný markdown wrapper, žádný komentář):

{
  "A_statistika": {
    "pocetZapisu": ${entries.length},
    "rozsahDni": <int>,
    "distribuceNalad": "string např. '1:0×, 2:1×, 3:4×, 4:2×, 5:1×'",
    "distribuceTypu": "string např. 'fakt:3×, úvaha:5×, ...'",
    "upozorneni": "string nebo null pokud vzorek OK"
  },
  "B_sixHats": {
    "bily_fakta": ["bullet 1", "bullet 2"],
    "cerveny_emoce": [...],
    "cerny_rizika": [...],
    "zluty_prinosy": [...],
    "zeleny_alternativy": [...],
    "modry_meta": [...]
  },
  "C_signalSum": {
    "konzistentniSignaly": [...],
    "naladoveSkrelene": [...],
    "recyklovaneUvahy": [...]
  },
  "D_preMortem": {
    "horizont": "Je rok 202X, rozhodnutí selhalo.",
    "duvody": ["důvod 1", "důvod 2", "důvod 3", "důvod 4", "důvod 5"]
  },
  "E_horizon10": {
    "za10Minut": "...",
    "za10Mesicu": "...",
    "za10Let": "..."
  },
  "F_wrapCheck": {
    "realneViceVariant": "...",
    "otestovanePredpoklady": "...",
    "dostatecnyOdstup": "...",
    "planB": "..."
  },
  "G_kriteria": ${d.kontext === "pracovni" ? '{ "pracovni": { "obchodni": "...", "financni": "...", "marketingovy": "...", "narocnostRealizace": "...", "strategickyFit": "..." } }' : d.kontext === "osobni" ? '{ "osobni": { "souladSHodnotami": "...", "vlivNaVztahy": "...", "vlivNaCasAEnergii": "...", "reverzibilita": "...", "souladSeZivotniFazi": "..." } }' : '{ "pracovni": {...stejné jako u pracovní}, "osobni": {...stejné jako u osobní} }'},
  "H_verdikt": {
    "doporuceni": "Konkrétní doporučení s odůvodněním (1-2 věty)",
    "hlavniArgumentPro": "...",
    "hlavniArgumentProti": "...",
    "coByPreklopilo": "Konkrétní nový fakt který by změnil verdikt (NE emoce)",
    "doporuceneDatumRevize": "YYYY-MM-DD (typicky 3-12 měsíců po deadline)"
  }
}`;

  const ai = getGemini();
  const response = await callTracked({
    module: "bwmys-finalni",
    modelName: ANALYSIS_MODEL,
    fn: () => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: "application/json" },
    }),
  });

  const raw = (response.text ?? "").trim();
  try {
    return JSON.parse(raw) as FinalniEvaluation;
  } catch (e) {
    throw new Error(`Finální vyhodnocení: nelze parse JSON. Prvních 200 znaků: ${raw.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Klasifikace úhlu pohledu (subprocess, volá se inline ve finalniVyhodnoceni
//    pokud entry má uhelPohledu="nevybrano" — řešeno v API endpointu, ne tady)
// ---------------------------------------------------------------------------

export type UhelPohledu = "fakta" | "emoce" | "kritika" | "prinosy" | "alternativy" | "meta";

export async function klasifikujUhly(obsahy: string[]): Promise<UhelPohledu[]> {
  if (obsahy.length === 0) return [];

  const prompt = `Klasifikuj každý zápis dle Six Thinking Hats:
- fakta (bílý) — věcné informace, čísla, pozorování
- emoce (červený) — pocity, intuice, nálada
- kritika (černý) — rizika, problémy, "co může selhat"
- prinosy (žlutý) — pozitiva, výhody
- alternativy (zelený) — kreativní nápady, jiné cesty
- meta (modrý) — pozorování o procesu rozhodování samotném

ZÁPISY:
${obsahy.map((o, i) => `[${i + 1}] ${o}`).join("\n\n")}

Vrať POUZE JSON pole stringů (jeden per zápis ve stejném pořadí):
["fakta", "emoce", "kritika", ...]`;

  const ai = getGemini();
  const response = await callTracked({
    module: "bwmys-klasifikace",
    modelName: ANALYSIS_MODEL,
    fn: () => ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: { temperature: 0.1, maxOutputTokens: 1000, responseMimeType: "application/json" },
    }),
  });

  const raw = (response.text ?? "").trim();
  try {
    const parsed = JSON.parse(raw);
    const allowed: UhelPohledu[] = ["fakta", "emoce", "kritika", "prinosy", "alternativy", "meta"];
    if (Array.isArray(parsed)) {
      return parsed.map((p) => allowed.includes(p) ? p : "meta") as UhelPohledu[];
    }
  } catch {
    // fallback — všem dej "meta"
  }
  return obsahy.map(() => "meta" as UhelPohledu);
}
