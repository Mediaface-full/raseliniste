import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { getGemini, getGeminiMode, DEFAULT_MODEL } from "@/lib/gemini";
import { callTracked } from "@/lib/gemini-usage";

export const prerender = false;

/**
 * GET /api/health/ai
 * Zjistí, ve kterém módu běží AI (vertex | api | unconfigured)
 * a provede testovací volání s krátkým promptem.
 *
 * Auth: session (jen pro přihlášeného usera).
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const mode = getGeminiMode();
  if (mode === "unconfigured") {
    return Response.json({ mode, ok: false, error: "AI není nakonfigurovaná." }, { status: 500 });
  }

  try {
    const genai = getGemini();
    const start = Date.now();
    const response = await callTracked({
      module: "health-check",
      modelName: DEFAULT_MODEL,
      userId: session.uid,
      fn: () => genai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: "Odpověz jedním slovem: jaký je opak slova 'severní'?",
        config: { temperature: 0, maxOutputTokens: 20 },
      }),
    });
    const elapsed = Date.now() - start;
    const text = (response.text ?? "").trim();

    return Response.json({
      ok: true,
      mode,
      model: DEFAULT_MODEL,
      elapsedMs: elapsed,
      sample: text,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, mode, error: msg }, { status: 500 });
  }
};
