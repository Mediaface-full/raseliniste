import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";
import { indexEntity } from "@/lib/rag";

export const prerender = false;

const subProposalSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  dueIsTime: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  rawSnippet: z.string().nullable().optional(),
  assignedToContactId: z.string().nullable().optional(),
  // Manuální override Smart routingu — Petr v UI klikl na chip 📁 a vybral
  // projekt sám. Pokud nastaveno, task-todoist-push.ts to preferuje před resolveRoute.
  manualTodoistProjectId: z.string().nullable().optional(),
  manualTodoistSectionId: z.string().nullable().optional(),
});

const proposalSchema = subProposalSchema.extend({
  // Hierarchie 1 úroveň — subtasks volitelné, samy už nemohou mít subtasks
  subtasks: z.array(subProposalSchema).optional(),
});

const schema = z.object({
  proposals: z.array(proposalSchema).min(1),
});

/**
 * POST /api/ukoly/audio/:batchId/commit
 * Body: { proposals: [{ title, ..., subtasks?: [...] }, ...] } — Petrem upravený seznam
 *
 * Vytvoří Task entries z předaných proposals (rodič + děti přes parentId),
 * batch se označí "committed", audio se smaže (transkript zůstane v batchi pro audit).
 *
 * Pořadí vytváření: nejdřív rodič, pak children s parentId.
 * Pořadí Todoist push v subsequent kroku (PUT /api/ukoly/<id>/push) nebo přes ruční push.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.batchId as string;
  const batch = await prisma.taskAudioBatch.findFirst({
    where: { id, userId: session.uid },
  });
  if (!batch) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  // Vytváření v transakci: rodič → jeho podúkoly s parentId.
  // Pořadí v DB nezáleží, ale je čistší rodič-první.
  const createdTaskIds: string[] = [];
  for (const p of parsed.data.proposals) {
    const parent = await prisma.task.create({
      data: {
        userId: session.uid,
        title: p.title,
        notes: p.notes ?? null,
        dueAt: p.dueAt ? new Date(p.dueAt) : null,
        dueIsTime: p.dueIsTime ?? false,
        tags: p.tags ?? [],
        priority: p.priority ?? "normal",
        assignedToContactId: p.assignedToContactId ?? null,
        manualTodoistProjectId: p.manualTodoistProjectId ?? null,
        manualTodoistSectionId: p.manualTodoistSectionId ?? null,
        source: "audio",
        sourceBatchId: batch.id,
        rawSnippet: p.rawSnippet ?? null,
      },
    });
    createdTaskIds.push(parent.id);

    // RAG indexace rodiče (fire-and-forget)
    try {
      const text = [parent.title, parent.notes ?? "", parent.rawSnippet ?? ""].filter(Boolean).join("\n\n");
      if (text.trim()) {
        void indexEntity({ userId: session.uid, sourceType: "task", sourceId: parent.id, text });
      }
    } catch { /* nikdy neblokuj */ }

    if (p.subtasks && p.subtasks.length > 0) {
      for (const s of p.subtasks) {
        const child = await prisma.task.create({
          data: {
            userId: session.uid,
            title: s.title,
            notes: s.notes ?? null,
            dueAt: s.dueAt ? new Date(s.dueAt) : null,
            dueIsTime: s.dueIsTime ?? false,
            // Tagy podúkolu = vlastní pokud má, jinak zděděné z rodiče
            tags: (s.tags && s.tags.length > 0) ? s.tags : (p.tags ?? []),
            priority: s.priority ?? p.priority ?? "normal",
            assignedToContactId: s.assignedToContactId ?? null,
            source: "audio",
            sourceBatchId: batch.id,
            rawSnippet: s.rawSnippet ?? null,
            parentId: parent.id,
          },
        });
        createdTaskIds.push(child.id);

        try {
          const text = [child.title, child.notes ?? "", child.rawSnippet ?? ""].filter(Boolean).join("\n\n");
          if (text.trim()) {
            void indexEntity({ userId: session.uid, sourceType: "task", sourceId: child.id, text });
          }
        } catch { /* nikdy neblokuj */ }
      }
    }
  }

  // Audio smazat (úkoly jsou vytvořené, audio už není potřeba),
  // transkript zůstane pro audit.
  if (batch.audioPath) {
    await deleteUpload(batch.audioPath).catch(() => null);
  }

  await prisma.taskAudioBatch.update({
    where: { id },
    data: {
      status: "committed",
      reviewedAt: new Date(),
      audioPath: null,
    },
  });

  // Auto-push do Todoistu — fire-and-forget, sériově (zachová parent→child pořadí
  // pro hierarchické úkoly). Chyby per-task se uloží do Task.pushError, zde jen logujeme.
  void (async () => {
    try {
      const { pushTaskToTodoist } = await import("@/lib/task-todoist-push");
      for (const taskId of createdTaskIds) {
        try {
          await pushTaskToTodoist(taskId);
        } catch (e) {
          console.warn(`[ukoly commit auto-push] task ${taskId} failed:`, e instanceof Error ? e.message : String(e));
        }
      }
    } catch (e) {
      console.warn("[ukoly commit auto-push] outer fail:", e instanceof Error ? e.message : String(e));
    }
  })();

  return Response.json({
    ok: true,
    createdTaskIds,
    count: createdTaskIds.length,
    note: "Push do Todoistu běží na pozadí — projeví se do několika sekund.",
  });
};
