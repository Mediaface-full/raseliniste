import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { answerQuestion } from "@/lib/rag";

export const prerender = false;

const Body = z.object({
  question: z.string().min(2).max(500),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const result = await answerQuestion({
      userId: session.uid,
      question: body.question.trim(),
    });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/ask]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
