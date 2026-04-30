import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/ukoly — list úkolů aktuálního usera
 * Query:
 *   ?status=open|done|cancelled|all (default: open)
 *   ?assignedTo=me|<contactId>|all  (default: all)
 *   ?tag=<tag>
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const status = url.searchParams.get("status") ?? "open";
  const assignedTo = url.searchParams.get("assignedTo") ?? "all";
  const tag = url.searchParams.get("tag");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId: session.uid };
  if (status !== "all") where.status = status;
  if (assignedTo === "me") where.assignedToContactId = null;
  else if (assignedTo !== "all") where.assignedToContactId = assignedTo;
  if (tag) where.tags = { has: tag };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      assignedToContact: { select: { id: true, displayName: true } },
    },
    take: 500,
  });

  // Také vrátíme všechny tagy pro filter UI
  const allTagsRaw = await prisma.task.findMany({
    where: { userId: session.uid },
    select: { tags: true },
  });
  const tagCounts = new Map<string, number>();
  for (const t of allTagsRaw) {
    for (const tag of t.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const tags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return Response.json({ tasks, tags });
};

const createSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dueIsTime: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assignedToContactId: z.string().nullable().optional(),
  source: z.enum(["manual", "audio", "quickadd", "capture"]).optional(),
  sourceBatchId: z.string().nullable().optional(),
  rawSnippet: z.string().nullable().optional(),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const d = parsed.data;

  const task = await prisma.task.create({
    data: {
      userId: session.uid,
      title: d.title,
      notes: d.notes ?? null,
      dueAt: d.dueAt ? new Date(d.dueAt) : null,
      dueIsTime: d.dueIsTime ?? false,
      tags: d.tags ?? [],
      priority: d.priority ?? "normal",
      assignedToContactId: d.assignedToContactId ?? null,
      source: d.source ?? "manual",
      sourceBatchId: d.sourceBatchId ?? null,
      rawSnippet: d.rawSnippet ?? null,
    },
    include: { assignedToContact: { select: { id: true, displayName: true } } },
  });

  // RAG indexace (fire-and-forget)
  try {
    const { indexEntity } = await import("@/lib/rag");
    const indexText = [task.title, task.notes ?? "", task.rawSnippet ?? ""].filter(Boolean).join("\n\n");
    if (indexText.trim()) {
      void indexEntity({
        userId: session.uid,
        sourceType: "task",
        sourceId: task.id,
        text: indexText,
      });
    }
  } catch {
    /* nikdy neblokuj odpověď */
  }

  return Response.json({ task });
};
