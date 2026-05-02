import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { createProject } from "@/lib/todoist";

export const prerender = false;

const Body = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().nullable().optional(),
  parentName: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

/**
 * POST /api/todoist/projects
 *
 * Vytvoří projekt v Todoistu.
 * Idempotence: pokud projekt se stejným jménem (case-insensitive) už existuje
 * v TodoistProjectMirror, vrátí existující ID bez volání Todoist API.
 *
 * Body: { name, parentId? | parentName?, color? }
 *  - parentId má přednost před parentName (lookup parent v mirror podle name)
 *
 * Vrátí: { project: { id, name, color, isInbox, parentId }, created: bool }
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

  // Idempotence — case-insensitive lookup v mirror
  const existing = await prisma.todoistProjectMirror.findFirst({
    where: { userId: session.uid, name: { equals: body.name, mode: "insensitive" } },
  });
  if (existing) {
    return Response.json({
      project: {
        id: existing.todoistId,
        name: existing.name,
        color: existing.color,
        isInbox: existing.isInbox,
        parentId: existing.parentId,
      },
      created: false,
      reason: "Projekt se stejným jménem už existuje (case-insensitive).",
    });
  }

  // Resolve parentId from parentName pokud potřeba
  let parentId = body.parentId ?? null;
  if (!parentId && body.parentName) {
    const parent = await prisma.todoistProjectMirror.findFirst({
      where: { userId: session.uid, name: { equals: body.parentName, mode: "insensitive" } },
    });
    if (!parent) {
      return Response.json(
        { error: `Parent projekt "${body.parentName}" nenalezen v mirroru. Spusť sync nebo ho vytvoř první.` },
        { status: 400 },
      );
    }
    parentId = parent.todoistId;
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  try {
    const created = await createProject(token, {
      name: body.name,
      parentId,
      color: body.color ?? null,
    });

    // Zapiš do mirroru hned, ať následný idempotence check ho najde i bez sync
    await prisma.todoistProjectMirror.upsert({
      where: { userId_todoistId: { userId: session.uid, todoistId: created.id } },
      update: { name: created.name, color: created.color ?? null, parentId: created.parent_id ?? null },
      create: {
        userId: session.uid,
        todoistId: created.id,
        name: created.name,
        color: created.color ?? null,
        isInbox: created.is_inbox_project ?? false,
        parentId: created.parent_id ?? null,
      },
    });

    return Response.json({
      project: {
        id: created.id,
        name: created.name,
        color: created.color,
        isInbox: created.is_inbox_project ?? false,
        parentId: created.parent_id ?? null,
      },
      created: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};
