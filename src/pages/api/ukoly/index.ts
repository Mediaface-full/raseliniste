import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/ukoly — list úkolů aktuálního usera (Task tabulka + VIP mise z CallLog)
 *
 * VIP mise z firewallu (CallLog wasVip=true) se zobrazují jako úkoly jednotně
 * s běžnými Task. Kliknutí na "hotovo" propíše seenAt do CallLog.
 *
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

  // Mirror Todoist projektů — pro UI mapování id → name
  const projectMirrors = await prisma.todoistProjectMirror.findMany({
    where: { userId: session.uid },
    select: { todoistId: true, name: true, color: true },
  });
  const projectNameById = new Map(projectMirrors.map((p) => [p.todoistId, p.name]));

  // Obohatit Task o todoistProjectName
  const tasksWithProject = tasks.map((t) => ({
    ...t,
    todoistProjectName: t.todoistProjectId ? (projectNameById.get(t.todoistProjectId) ?? null) : null,
  }));

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

  // VIP mise z firewallu (CallLog) — sjednotit s Task view.
  // Show open VIP missions always (when status filter is "open" or "all")
  // a recently completed (seenAt < 14 dní zpět) když status=done/all.
  const includeVipOpen = status === "open" || status === "all";
  const includeVipDone = status === "done" || status === "all";
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

  // Aplikuj assignedTo filter i na VIP mise — bez něj filter 'Honza Svěrák'
  // vrátil prisma tasks JEN pro Honzu, ALE VIP mise od Lucie/Gáti se přesto
  // zobrazily protože VIP query byla bezpodmínečná. Fix 2026-06-19 Gideon.
  const vipAssigneeFilter =
    assignedTo === "all" ? {} :
    assignedTo === "me" ? { contactId: null } :
    { contactId: assignedTo };

  const vipCalls = await prisma.callLog.findMany({
    where: {
      userId: session.uid,
      wasVip: true,
      ...(tag ? { id: "__never__" } : {}), // VIP mise nemají tagy → tag filtr je vyřadí
      ...vipAssigneeFilter,
      OR: [
        ...(includeVipOpen ? [{ seenAt: null }] : []),
        ...(includeVipDone ? [{ seenAt: { gte: fourteenDaysAgo } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      message: true,
      isUrgent: true,
      requestedDueAt: true,
      seenAt: true,
      createdAt: true,
      todoistTaskId: true,
      contactId: true,
      contact: { select: { displayName: true, firstName: true } },
    },
  });

  // Map CallLog na Task-shape pro UI (typ rozliší source="vip_call_log").
  const vipTasks = vipCalls.map((c) => ({
    id: `callLog:${c.id}`,
    callLogId: c.id,
    userId: session.uid,
    title: c.message,
    notes: null as string | null,
    dueAt: c.requestedDueAt,
    dueIsTime: false,
    tags: [] as string[],
    status: c.seenAt ? "done" : "open",
    priority: c.isUrgent ? "high" : "normal",
    source: "vip_call_log",
    todoistTaskId: c.todoistTaskId,
    todoistProjectId: null as string | null,
    completedAt: c.seenAt,
    createdAt: c.createdAt,
    updatedAt: c.seenAt ?? c.createdAt,
    rawSnippet: null as string | null,
    sourceBatchId: null as string | null,
    parentId: null as string | null,
    pushedAt: null as Date | null,
    pushError: null as string | null,
    assignedToContactId: c.contactId,
    assignedToContact: c.contact ? {
      id: c.contactId,
      displayName: `${c.contact.firstName ?? c.contact.displayName} `,
    } : null,
  }));

  // Sjednoceno — VIP mise nahoru pokud naléhavé, jinak chronologicky.
  const allTasks = [...vipTasks, ...tasksWithProject].sort((a, b) => {
    // priority high prvně
    const pa = a.priority === "high" ? 0 : 1;
    const pb = b.priority === "high" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    // pak open před done
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    // pak chronologicky (nejnovější top)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return Response.json({
    tasks: allTasks,
    tags,
    todoistProjects: projectMirrors,
  });
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

  // Auto-push do Todoistu (fire-and-forget). Todoist je primary tool — manuální
  // create v /ukoly se okamžitě propíše do Todoist appce, žádné druhé klikání.
  // Chyby per-task se uloží do Task.pushError, response se neblokuje.
  void (async () => {
    try {
      const { pushTaskToTodoist } = await import("@/lib/task-todoist-push");
      await pushTaskToTodoist(task.id);
    } catch (e) {
      console.warn(`[ukoly create auto-push] task ${task.id} failed:`, e instanceof Error ? e.message : String(e));
    }
  })();

  return Response.json({ task });
};
