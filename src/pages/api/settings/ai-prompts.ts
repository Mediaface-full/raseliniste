import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { listAllPrompts, PROMPT_LABELS } from "@/lib/ai-prompts";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const prompts = await listAllPrompts();
  return Response.json({
    prompts: prompts.map((p) => ({
      ...p,
      ...PROMPT_LABELS[p.module],
      updatedAt: p.updatedAt?.toISOString() ?? null,
    })),
  });
};
