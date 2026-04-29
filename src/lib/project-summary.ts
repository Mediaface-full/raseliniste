/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

/**
 * AI souhrn celého projektu — projede všechny recordings (briefy s vyšší vahou)
 * a vyrobí strukturovaný dokument o stavu projektu.
 *
 * Volá se ručně z `/studna/:id` přes tlačítko „Souhrn projektu".
 * Stojí cca $0.05-$0.20 v závislosti na množství obsahu.
 */

export interface SummaryRecording {
  authorName: string;
  type: "STANDARD" | "BRIEF";
  createdAt: Date;
  transcript: string;
  analysis: any;
}

export async function summarizeProject(params: {
  projectName: string;
  projectDescription: string | null;
  recordings: SummaryRecording[];
}): Promise<{ text: string; model: string; recordingsIncluded: number; briefsIncluded: number }> {
  if (params.recordings.length === 0) {
    return { text: "Projekt zatím neobsahuje žádné záznamy.", model: ANALYSIS_MODEL, recordingsIncluded: 0, briefsIncluded: 0 };
  }

  // Briefy poskytují primární kontext, standardy jsou doplňky.
  const briefs = params.recordings.filter((r) => r.type === "BRIEF");
  const standards = params.recordings.filter((r) => r.type === "STANDARD");

  const sections: string[] = [];

  if (briefs.length > 0) {
    sections.push("=== KLÍČOVÉ BRIEFY (primární kontext) ===\n");
    for (const b of briefs) {
      sections.push(`--- BRIEF od ${b.authorName} (${b.createdAt.toLocaleDateString("cs-CZ")}) ---`);
      sections.push(`Souhrn: ${b.analysis?.summary ?? "(chybí)"}`);
      if (b.analysis?.glossary?.length) {
        sections.push(`Glosář: ${b.analysis.glossary.map((g: any) => `${g.term} = ${g.definition}`).join("; ")}`);
      }
      if (b.analysis?.actors?.length) {
        sections.push(`Aktéři: ${b.analysis.actors.map((a: any) => `${a.name} (${a.role})`).join("; ")}`);
      }
      if (b.analysis?.decision_history?.length) {
        sections.push(`Rozhodnutí: ${b.analysis.decision_history.join("; ")}`);
      }
      sections.push("");
    }
  }

  if (standards.length > 0) {
    sections.push("=== STANDARDNÍ ZÁZNAMY (doplňující kontext) ===\n");
    for (const s of standards) {
      const thoughts = (s.analysis?.thoughts ?? [])
        .map((t: any) => `[${t.importance}] ${t.text}`)
        .join("\n  ");
      sections.push(
        `--- Záznam od ${s.authorName} (${s.createdAt.toLocaleDateString("cs-CZ")}, sentiment: ${s.analysis?.sentiment ?? "n/a"}) ---`,
      );
      sections.push(`Souhrn: ${s.analysis?.summary ?? "(chybí)"}`);
      if (thoughts) sections.push(`Myšlenky:\n  ${thoughts}`);
      if (s.analysis?.open_questions?.length) {
        sections.push(`Otevřené otázky: ${s.analysis.open_questions.join("; ")}`);
      }
      sections.push("");
    }
  }

  const recordingsBundle = sections.join("\n");

  const prompt = `Jsi senior projektový analytik. Projdi všechny dostupné podklady projektu „${params.projectName}" a vytvoř pro Petra strukturovaný **stav projektu** v markdownu.

${params.projectDescription ? `Kontext: ${params.projectDescription}\n\n` : ""}
Tvoje úkoly:

1. **Brief-driven kontext** — pokud jsou v podkladech briefy, ber je jako primární zdroj pravdy o projektu (kdo, co, proč, historie). Standardní záznamy jsou doplňující.

2. **Strukturovaný výstup** — vytvoř detailní markdown dokument (klidně 800-2500 slov) s těmito sekcemi:

   ## O projektu
   Kontext, historie, hlavní cíl. Z briefů.

   ## Klíčové postavy
   Tabulka jmen / rolí / co o nich víme. Z briefů (\`actors\`).

   ## Co je rozhodnuté
   Bullet list rozhodnutí, která zazněla. Source: \`decision_history\` z briefů + standardy s category="rozhodnutí".

   ## Co se aktuálně řeší
   Diskutovaná témata, kde ještě není jasno. Source: thoughts s category="otázka" + open_questions.

   ## Otevřené otázky
   Konsolidovaný seznam open_questions napříč všemi záznamy, deduplikovaný.

   ## Hlavní myšlenky a nápady
   Důležité myšlenky (importance="high"), seskupené podle tématu. Pro každou uveď autora.

   ## Sentiment a momentum
   Co se v podkladech opakuje, čemu autoři věnují nejvíc času, kde cítí nejistotu nebo nadšení. Z \`intensity_signals\` a \`sentiment\`.

   ## Glosář
   Tabulka termínů z briefů (term + definice + zkratka pro Petra v jedné větě).

   ## Doporučené další kroky
   Tvůj návrh, co Petr může udělat, aby projekt posunul. 3-7 konkrétních akcí.

3. **Citace autorů** — kdy je to relevantní, uveď, kdo myšlenku přinesl (např. „Karel zmínil, že …"). Buduješ Petrovi mentální mapu, kdo si co myslí.

4. **Hloubka, ne plnění slovy** — buď bohatý, ale konkrétní. Žádné generické fráze typu „je důležité dál sledovat vývoj".

Vrať POUZE markdown bez úvodního komentáře. Začni rovnou nadpisem \`# Stav projektu: ${params.projectName}\`.

PODKLADY:

${recordingsBundle}`;

  const genai = getGemini();
  const response = await callTracked({
    module: "project-summary",
    modelName: ANALYSIS_MODEL,
    fn: () => genai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        temperature: 0.4,
        maxOutputTokens: 16000,
      },
    }),
  });

  const text = (response.text ?? "").trim();
  if (!text) throw new Error("Gemini Pro vrátil prázdný výstup.");

  return {
    text,
    model: ANALYSIS_MODEL,
    recordingsIncluded: params.recordings.length,
    briefsIncluded: briefs.length,
  };
}
