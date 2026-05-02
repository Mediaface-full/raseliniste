import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { createLabel } from "@/lib/todoist";

export const prerender = false;

const Body = z.object({
  name: z.string().min(1).max(60),
  color: z.string().nullable().optional(),
});

/**
 * POST /api/todoist/labels
 *
 * Vytvoří label v Todoistu (personal label u free tier, shared u paid).
 * Idempotence: pokud label se stejným jménem (case-insensitive) už existuje
 * v TodoistLabelMirror, vrátí existující ID bez volání Todoist API.
 *
 * Vrátí: { label: { id, name, color }, created: bool }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ error: "Todoist integrace není nakonfigurovaná." }, { status: 400 });
  }

  const existing = await prisma.todoistLabelMirror.findFirst({
    where: { userId: session.uid, name: { equals: body.name, mode: "insensitive" } },
  });
  if (existing) {
    return Response.json({
      label: { id: existing.todoistId, name: existing.name, color: existing.color },
      created: false,
      reason: "Label se stejným jménem už existuje.",
    });
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  try {
    const created = await createLabel(token, { name: body.name, color: body.color ?? null });

    await prisma.todoistLabelMirror.upsert({
      where: { userId_todoistId: { userId: session.uid, todoistId: created.id } },
      update: { name: created.name, color: created.color ?? null },
      create: {
        userId: session.uid,
        todoistId: created.id,
        name: created.name,
        color: created.color ?? null,
      },
    });

    return Response.json({
      label: { id: created.id, name: created.name, color: created.color ?? null },
      created: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};
