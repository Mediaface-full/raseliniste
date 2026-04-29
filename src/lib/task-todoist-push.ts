import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { createTask as todoistCreateTask } from "./todoist";

/**
 * Push standalone Task (modul Úkoly /ukoly) do Todoistu.
 * Idempotent přes Task.todoistTaskId — pokud už je pushnutý, no-op.
 *
 * Mapování:
 *   - title → content
 *   - notes + delegace + tagy + raw snippet → description
 *   - dueAt → due_date (YYYY-MM-DD) nebo due_datetime
 *   - tags → labels (lowercase, ASCII safe)
 *   - priority: high → 4, normal → 2 (Todoist invertuje), low → 1
 *   - target project: Petrův "mojeUkoly" project z UserIntegration.config
 */

const PRIORITY_MAP = { high: 4, normal: 2, low: 1 } as const;

export async function pushTaskToTodoist(taskId: string): Promise<{ taskId: string; projectId: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignedToContact: { select: { displayName: true } },
    },
  });
  if (!task) throw new Error("Úkol nenalezen.");
  if (task.todoistTaskId) {
    return { taskId: task.todoistTaskId, projectId: task.todoistProjectId ?? "" };
  }

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: task.userId, provider: "todoist" } },
  });
  if (!integration) {
    throw new Error("Todoist integrace není nakonfigurovaná. Nastavení → Todoist.");
  }

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });
  const cfg = ((integration.config as unknown) ?? {}) as { mojeUkoly?: string };
  const projectId = cfg.mojeUkoly || undefined;

  // Sestav description s kontextem
  const descLines: string[] = [];
  if (task.assignedToContact) {
    descLines.push(`👤 Přiděleno: **${task.assignedToContact.displayName}**`);
  }
  if (task.notes) descLines.push(task.notes);
  if (task.rawSnippet) descLines.push(`\n_„${task.rawSnippet}"_`);
  descLines.push(`\n_Z Rašeliniště — ${new Date(task.createdAt).toLocaleString("cs-CZ")}_`);

  // Due
  let due_date: string | undefined;
  let due_datetime: string | undefined;
  if (task.dueAt) {
    if (task.dueIsTime) {
      due_datetime = task.dueAt.toISOString();
    } else {
      due_date = task.dueAt.toISOString().slice(0, 10);
    }
  }

  // Labels — lowercase ASCII, max 30 znaků
  const labels = ["raseliniste", ...task.tags].map((t) =>
    t.toLowerCase().replace(/\s+/g, "-").slice(0, 30),
  );
  if (task.assignedToContact) {
    const slug = task.assignedToContact.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    if (slug && !labels.includes(slug)) labels.push(slug);
  }

  try {
    const created = await todoistCreateTask(token, {
      content: task.title.slice(0, 500),
      description: descLines.join("\n").slice(0, 16000) || undefined,
      project_id: projectId,
      priority: PRIORITY_MAP[task.priority],
      due_string: undefined,
      labels,
      ...(due_date ? { due_date } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(due_datetime ? ({ due_datetime } as any) : {}),
    });

    await prisma.task.update({
      where: { id: task.id },
      data: {
        todoistTaskId: created.id,
        todoistProjectId: created.project_id,
        pushedAt: new Date(),
        pushError: null,
      },
    });

    await prisma.userIntegration.update({
      where: { id: integration.id },
      data: { lastUsedAt: new Date(), lastError: null },
    });

    return { taskId: created.id, projectId: created.project_id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.task.update({
      where: { id: task.id },
      data: { pushError: msg.slice(0, 500) },
    });
    throw e;
  }
}
