import { getGemini, DEFAULT_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";

/**
 * "Učesat" tlačítko v editoru dopisu.
 *
 * Vstup: rawText (uživatelův holý text), redactPrompt (z odesílatele),
 *        + volitelný override (per-dopis tweak).
 *
 * Výstup: čistý finální text k vložení do PDF.
 */
export async function redactLetter(params: {
  rawText: string;
  basePrompt: string;
  override?: string | null;
}): Promise<{ text: string; model: string; promptChars: number }> {
  const promptParts: string[] = [params.basePrompt];
  if (params.override?.trim()) {
    promptParts.push("");
    promptParts.push("Dodatečné instrukce k tomuto konkrétnímu dopisu:");
    promptParts.push(params.override.trim());
  }
  promptParts.push("");
  promptParts.push("Vstupní text dopisu:");
  promptParts.push("---");
  promptParts.push(params.rawText);
  promptParts.push("---");
  promptParts.push("");
  promptParts.push("Vrať pouze upravený text dopisu — žádný úvod, žádné komentáře, žádné značky.");

  const finalPrompt = promptParts.join("\n");

  const genai = getGemini();
  const response = await callTracked({
    module: "letter-redact",
    modelName: DEFAULT_MODEL,
    fn: () => genai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: finalPrompt,
      config: {
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    }),
  });

  const text = (response.text ?? "").trim();
  if (!text) {
    throw new Error("Gemini vrátil prázdný výstup.");
  }

  return {
    text,
    model: DEFAULT_MODEL,
    promptChars: finalPrompt.length,
  };
}
