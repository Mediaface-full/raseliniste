import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { getGemini, DEFAULT_MODEL, FAST_MODEL } from "@/lib/gemini";
import { callTracked } from "@/lib/gemini-usage";

export const prerender = false;

const Body = z.object({
  prompt: z.string().min(1).max(10_000),
  fast: z.boolean().optional().default(false),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const gemini = getGemini();
    const model = body.fast ? FAST_MODEL : DEFAULT_MODEL;
    const result = await callTracked({
      module: "ai-chat",
      modelName: model,
      userId: session.uid,
      fn: () => gemini.models.generateContent({ model, contents: body.prompt }),
    });
    return Response.json({ text: result.text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gemini request failed";
    return Response.json({ error: "GEMINI_ERROR", message: msg }, { status: 500 });
  }
};
