/**
 * Things bulk import — zpracování srovnaného JSON.
 *
 * Uživatel projde Things JSON ručně mimo Rašeliniště (s pomocí kouče
 * v jiné konverzaci) a vytvoří strukturovaný JSON, kde každý úkol
 * má rozhodnutí: migrate / wishlist / discard.
 *
 * Tahle vrstva:
 *   - validuje strukturovaný JSON (zod)
 *   - executeImport() spustí dispatch — projektový/labelový resolve,
 *     vytvoření Task / Entry, push do Todoistu
 *   - drží referenci přes module-level Set (fire-and-forget pinning,
 *     stejně jako u Studny)
 */

import { z } from "zod";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { createTask } from "./todoist";

// ---------------------------------------------------------------------------
// Zod schema curated JSON
// ---------------------------------------------------------------------------

const baseItem = z.object({
  thingsUuid: z.string().min(1),
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).nullable().optional(),
});

const subtaskItem = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).nullable().optional(),
});

const migrateItem = baseItem.extend({
  decision: z.literal("migrate"),
  targetProject: z.string().min(1),
  targetParent: z.string().nullable().optional(),
  targetLabels: z.array(z.string()).default([]),
  targetDue: z.string().nullable().optional(),
  targetPriority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  // Volitelné subtasks. V Todoistu se vytvoří jako podúkoly s parent_id =
  // Todoist ID právě vytvořeného parent tasku. Dědí projekt, priority,
  // labels od parenta. Vlastní due/priority subtasků zatím nepodporujeme —
  // pokud potřeba, dá se rozšířit. Idempotence: stejně jako u parent (status
  // guard na endpointu — re-run importu není možný).
  subtasks: z.array(subtaskItem).optional().default([]),
});

const wishlistItem = baseItem.extend({
  decision: z.literal("wishlist"),
  knowledgeCategory: z.string().min(1),
  knowledgeUrl: z.string().url().nullable().optional(),
  knowledgeTags: z.array(z.string()).default([]),
});

const discardItem = baseItem.extend({
  decision: z.literal("discard"),
});

export const CuratedItem = z.discriminatedUnion("decision", [migrateItem, wishlistItem, discardItem]);

export const CuratedFile = z.object({
  source: z.literal("things-export-curated"),
  createdAt: z.string().optional(),
  items: z.array(CuratedItem),
}).superRefine((data, ctx) => {
  // thingsUuid musí být unikátní napříč items
  const seen = new Set<string>();
  data.items.forEach((it, i) => {
    if (seen.has(it.thingsUuid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", i, "thingsUuid"],
        message: `Duplicate thingsUuid: ${it.thingsUuid}`,
      });
    }
    seen.add(it.thingsUuid);
  });
});

export type CuratedItemT = z.infer<typeof CuratedItem>;
export type CuratedFileT = z.infer<typeof CuratedFile>;

/**
 * Pre-flight check — ověř že všechny migrate items mají existující projekt
 * v TodoistProjectMirror (case-insensitive). Vrátí seznam chybějících
 * projektů (deduplikovaný), prázdný array = OK.
 */
export async function preflightProjectCheck(
  userId: string,
  items: CuratedItemT[],
): Promise<string[]> {
  const migrateProjects = new Set<string>();
  for (const item of items) {
    if (item.decision === "migrate") {
      const key = item.targetParent
        ? `${item.targetParent} > ${item.targetProject}`
        : item.targetProject;
      migrateProjects.add(key);
    }
  }
  if (migrateProjects.size === 0) return [];

  const projects = await prisma.todoistProjectMirror.findMany({
    where: { userId },
    select: { name: true, parentId: true, todoistId: true },
  });
  const nameLower = new Set(projects.map((p) => p.name.toLowerCase()));

  const missing: string[] = [];
  for (const key of migrateProjects) {
    const parts = key.split(" > ");
    const target = (parts[parts.length - 1] ?? key).toLowerCase();
    if (!nameLower.has(target)) missing.push(key);
  }
  return missing;
}

export function summarize(items: CuratedItemT[]): {
  total: number;
  migrate: number;
  wishlist: number;
  discard: number;
} {
  return {
    total: items.length,
    migrate: items.filter((i) => i.decision === "migrate").length,
    wishlist: items.filter((i) => i.decision === "wishlist").length,
    discard: items.filter((i) => i.decision === "discard").length,
  };
}

// ---------------------------------------------------------------------------
// Dispatch — async processing s pinning přes module-level Set
// ---------------------------------------------------------------------------

interface InFlight {
  importId: string;
  startedAt: number;
  promise: Promise<void>;
}
const inFlight = new Set<InFlight>();

/**
 * Naše curated spec: targetPriority 1 = nejvyšší, 4 = nejnižší (intuitivní).
 * Todoist API ale: priority 4 = urgent, 1 = lowest.
 * Při push do Todoist musíme INVERTovat: (5 - x).
 *
 * Pro naši Task tabulku (low/normal/high) mapujeme dle naší spec:
 *   1 (highest) → high
 *   2 → high
 *   3 → normal
 *   4 (lowest) → low
 */
function curatedPriorityToTaskLevel(p: number): "low" | "normal" | "high" {
  if (p === 1 || p === 2) return "high";
  if (p === 3) return "normal";
  return "low";
}

function curatedPriorityToTodoistApi(p: number): 1 | 2 | 3 | 4 {
  // Invert: naše 1 (highest) → Todoist 4 (urgent); naše 4 (lowest) → Todoist 1
  const inverted = 5 - p;
  if (inverted === 1 || inverted === 2 || inverted === 3 || inverted === 4) return inverted as 1 | 2 | 3 | 4;
  return 1; // fallback lowest
}

async function resolveProjectId(
  userId: string,
  targetProject: string,
  targetParent: string | null | undefined,
): Promise<string | null> {
  const projects = await prisma.todoistProjectMirror.findMany({
    where: { userId },
    select: { todoistId: true, name: true, parentId: true },
  });

  const matchByName = (name: string) =>
    projects.find((p) => p.name.toLowerCase() === name.toLowerCase());

  if (!targetParent) {
    return matchByName(targetProject)?.todoistId ?? null;
  }

  // Hierarchie: najdi parent, pak child s parentId === parent.todoistId
  const parent = matchByName(targetParent);
  if (!parent) return null;
  const child = projects.find(
    (p) => p.parentId === parent.todoistId && p.name.toLowerCase() === targetProject.toLowerCase(),
  );
  // Fallback — pokud není hierarchický match, najdi alespoň podle name
  return child?.todoistId ?? matchByName(targetProject)?.todoistId ?? null;
}

function parseDueString(due: string | null | undefined):
  | { dueAt: Date | null; dueIsTime: boolean; dueString: string | null } {
  if (!due) return { dueAt: null, dueIsTime: false, dueString: null };

  // ISO datum YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return {
      dueAt: new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)),
      dueIsTime: false,
      dueString: due,
    };
  }

  // Relativní výrazy — Todoist je rozumí přes due_string, naše DB je nemá kde
  // uložit (nemáme parser dnů). Necháme dueAt null, předáme due_string Todoistu.
  return { dueAt: null, dueIsTime: false, dueString: due };
}

export async function executeImport(importId: string): Promise<void> {
  const entry: InFlight = { importId, startedAt: Date.now(), promise: Promise.resolve() };

  entry.promise = (async () => {
    try {
      console.log(`[things-import] ${importId} start`);

      const imp = await prisma.thingsImport.findUnique({
        where: { id: importId },
        include: { items: true },
      });
      if (!imp) {
        console.warn(`[things-import] ${importId} not found`);
        return;
      }

      await prisma.thingsImport.update({
        where: { id: importId },
        data: { status: "executing" },
      });

      const userId = imp.userId;
      const integration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId, provider: "todoist" } },
      });
      const todoistToken = integration
        ? decryptSecret({ enc: integration.tokenEnc, iv: integration.tokenIv, tag: integration.tokenTag })
        : null;

      const errors: Array<{ thingsUuid: string; title: string; error: string }> = [];
      const itemsByUuid = new Map(imp.items.map((it) => [it.thingsUuid, it]));

      // raw items z payloadu (validovaný)
      const raw = (imp.rawJson as unknown) as CuratedFileT;

      for (const item of raw.items) {
        const dbItem = itemsByUuid.get(item.thingsUuid);
        if (!dbItem) continue; // sanity — měl by existovat

        try {
          if (item.decision === "discard") {
            await prisma.thingsImportItem.update({
              where: { id: dbItem.id },
              data: { pushResult: "skipped", pushedAt: new Date() },
            });
            continue;
          }

          if (item.decision === "wishlist") {
            // Knowledge Entry — přeskakuje triage (status=CONFIRMED).
            // Entry vyžaduje recordingId; synthetic recording se source=MANUAL
            // (RecordingSource enum nemá things_import — používáme nejbližší).
            const rec = await prisma.recording.create({
              data: {
                userId,
                source: "MANUAL",
                rawText: `[Things import] ${item.title}`,
                processedAt: new Date(),
              },
            });
            const noteText = item.notes?.trim() ? `\n\n${item.notes.trim()}` : "";
            const entryRow = await prisma.entry.create({
              data: {
                recordingId: rec.id,
                type: "KNOWLEDGE",
                text: `${item.title}${noteText}`,
                knowledgeCategory: item.knowledgeCategory,
                knowledgeUrl: item.knowledgeUrl ?? null,
                knowledgeTags: item.knowledgeTags ?? [],
                status: "CONFIRMED",
                confirmedAt: new Date(),
              },
            });
            await prisma.thingsImportItem.update({
              where: { id: dbItem.id },
              data: { pushResult: "ok", pushedTaskId: entryRow.id, pushedAt: new Date() },
            });
            continue;
          }

          // decision === "migrate"
          if (!todoistToken) {
            throw new Error("Todoist integrace není nakonfigurovaná — migrace přerušena.");
          }

          const projectId = await resolveProjectId(userId, item.targetProject, item.targetParent ?? null);
          if (!projectId) {
            throw new Error(
              `Projekt "${item.targetProject}"${item.targetParent ? ` pod "${item.targetParent}"` : ""} nenalezen v Todoist mirroru. Spusť sync nebo ho vytvoř.`,
            );
          }

          const { dueAt, dueIsTime, dueString } = parseDueString(item.targetDue);

          // Vytvoř Task v naší DB
          const task = await prisma.task.create({
            data: {
              userId,
              title: item.title,
              notes: item.notes?.trim() || null,
              dueAt,
              dueIsTime,
              tags: item.targetLabels ?? [],
              priority: curatedPriorityToTaskLevel(item.targetPriority),
              status: "open",
              source: "things_import",
              todoistProjectId: projectId,
            },
          });

          // Push do Todoistu — priorita INVERTovaná (naše 1=highest, Todoist 4=urgent)
          const todoistTask = await createTask(todoistToken, {
            content: item.title.slice(0, 500),
            description: item.notes?.trim() || undefined,
            project_id: projectId,
            priority: curatedPriorityToTodoistApi(item.targetPriority),
            labels: item.targetLabels ?? [],
            due_string: dueString ?? undefined,
          });

          await prisma.task.update({
            where: { id: task.id },
            data: { todoistTaskId: todoistTask.id, pushedAt: new Date() },
          });

          // Subtasks — vytvoř každý jako podúkol s parent_id = todoistTask.id.
          // Dědí projekt + priority + labels od parenta. Selhání jednoho
          // subtasku nezhodí parent flow — zalogujeme do errors a jedeme dál.
          const subtaskErrors: string[] = [];
          let subtasksPushed = 0;
          for (const sub of item.subtasks ?? []) {
            try {
              const subTask = await prisma.task.create({
                data: {
                  userId,
                  title: sub.title,
                  notes: sub.notes?.trim() || null,
                  tags: item.targetLabels ?? [],
                  priority: curatedPriorityToTaskLevel(item.targetPriority),
                  status: "open",
                  source: "things_import",
                  todoistProjectId: projectId,
                  parentId: task.id,
                },
              });
              const subTodoist = await createTask(todoistToken, {
                content: sub.title.slice(0, 500),
                description: sub.notes?.trim() || undefined,
                parent_id: todoistTask.id,
                priority: curatedPriorityToTodoistApi(item.targetPriority),
                labels: item.targetLabels ?? [],
              });
              await prisma.task.update({
                where: { id: subTask.id },
                data: { todoistTaskId: subTodoist.id, pushedAt: new Date() },
              });
              subtasksPushed++;
            } catch (subErr) {
              const sm = subErr instanceof Error ? subErr.message : String(subErr);
              subtaskErrors.push(`subtask "${sub.title.slice(0, 60)}": ${sm.slice(0, 150)}`);
              errors.push({
                thingsUuid: `${item.thingsUuid}#sub`,
                title: `[subtask] ${sub.title}`,
                error: sm,
              });
            }
          }

          const totalSubs = item.subtasks?.length ?? 0;
          const pushResult = subtaskErrors.length === 0
            ? (totalSubs > 0 ? `ok (+${subtasksPushed} subtasks)` : "ok")
            : `partial: parent ok, ${subtasksPushed}/${totalSubs} subtasks; ${subtaskErrors.join("; ").slice(0, 400)}`;

          await prisma.thingsImportItem.update({
            where: { id: dbItem.id },
            data: {
              pushResult,
              pushedTaskId: todoistTask.id,
              pushedAt: new Date(),
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await prisma.thingsImportItem.update({
            where: { id: dbItem.id },
            data: { pushResult: `error: ${msg.slice(0, 200)}`, pushedAt: new Date() },
          });
          errors.push({ thingsUuid: item.thingsUuid, title: item.title, error: msg });
        }
      }

      await prisma.thingsImport.update({
        where: { id: importId },
        data: {
          status: "completed",
          completedAt: new Date(),
          errorLog: errors.length > 0 ? (errors as unknown as object) : undefined,
        },
      });
      console.log(`[things-import] ${importId} done in ${Date.now() - entry.startedAt}ms (${errors.length} errors)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[things-import] ${importId} fatal:`, msg);
      await prisma.thingsImport.update({
        where: { id: importId },
        data: { status: "failed", completedAt: new Date(), errorLog: { fatal: msg } },
      }).catch(() => null);
    } finally {
      inFlight.delete(entry);
    }
  })();

  inFlight.add(entry);
}

export function getInFlightImports(): Array<{ importId: string; ageMs: number }> {
  const now = Date.now();
  return Array.from(inFlight).map((e) => ({ importId: e.importId, ageMs: now - e.startedAt }));
}
