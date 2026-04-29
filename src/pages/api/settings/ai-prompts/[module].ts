import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { setPrompt, resetPrompt, type PromptModule } from "@/lib/ai-prompts";

export const prerender = false;

const VALID_MODULES: PromptModule[] = [
  "ozvena-stage1-transcribe",
  "ozvena-stage2-task",
  "ozvena-stage2-journal",
  "denik-monthly-review",
  "studna-standard",
  "studna-brief",
  "briefing-nightly",
];

const putSchema = z.object({
  content: z.string().min(10).max(50_000),
});

export const PUT: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const module = params.module as PromptModule;
  if (!VALID_MODULES.includes(module)) {
    return Response.json({ error: "INVALID_MODULE" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  await setPrompt(module, parsed.data.content);
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const module = params.module as PromptModule;
  if (!VALID_MODULES.includes(module)) {
    return Response.json({ error: "INVALID_MODULE" }, { status: 400 });
  }

  await resetPrompt(module);
  return Response.json({ ok: true });
};
