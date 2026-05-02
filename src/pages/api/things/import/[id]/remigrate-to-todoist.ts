import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { createProject, createTask } from "@/lib/todoist";

export const prerender = false;

/**
 * POST /api/things/import/:id/remigrate-to-todoist
 *
 * Petr tě prosil, aby wishlist body skončily v Todoistu — ale původní impl
 * je dělala jako Knowledge entries. Tohle to dotáhne dodatečně:
 *
 *   1. Auto-create Todoist projekt "Wishlist" pokud neexistuje
 *   2. Pro každý item s decision="wishlist" (z ThingsImport.rawJson):
 *      - Vytvoří Todoist task v projektu Wishlist (priority lowest)
 *      - knowledgeCategory → labels[] (pokud existoval)
 *      - knowledgeTags → labels[] (extra)
 *      - knowledgeUrl → description prefix (pokud existoval)
 *      - Updatuje ThingsImportItem.pushedTaskId na Todoist task ID
 *      - Smaže odpovídající Entry + Recording (cleanup duplicit)
 *   3. Vrátí summary: created Todoist tasks, deleted Knowledge entries
 *
 * Idempotentní v rámci items: pokud už mají pushedTaskId (po remigraci),
 * vynechá je. Po prvním proběhnutí druhý klik nedělá nic.
 */
export const POST: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const imp = await prisma.thingsImport.findFirst({
    where: { id, userId: session.uid },
    include: { items: true },
  });
  if (!imp) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ error: "Todoist integrace není nakonfigurovaná." }, { status: 400 });
  }
  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  // 1. Najdi nebo vytvoř Todoist projekt "Wishlist"
  let wishlistProject = await prisma.todoistProjectMirror.findFirst({
    where: { userId: session.uid, name: { equals: "Wishlist", mode: "insensitive" } },
  });
  let createdProject = false;
  if (!wishlistProject) {
    try {
      const created = await createProject(token, { name: "Wishlist" });
      wishlistProject = await prisma.todoistProjectMirror.create({
        data: {
          userId: session.uid,
          todoistId: created.id,
          name: created.name,
          color: created.color ?? null,
          isInbox: created.is_inbox_project ?? false,
          parentId: created.parent_id ?? null,
        },
      });
      createdProject = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json(
        { error: `Nepodařilo se vytvořit projekt Wishlist v Todoistu: ${msg}` },
        { status: 500 },
      );
    }
  }

  // 2. Vezmi raw JSON, projdi items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = imp.rawJson as any;
  const rawItems: Array<{
    thingsUuid: string;
    title: string;
    notes?: string | null;
    decision: string;
    knowledgeCategory?: string;
    knowledgeUrl?: string | null;
    knowledgeTags?: string[];
  }> = Array.isArray(raw?.items) ? raw.items : [];

  const wishlistItems = rawItems.filter((it) => it.decision === "wishlist");
  const dbItemsByUuid = new Map(imp.items.map((it) => [it.thingsUuid, it]));

  let createdTasks = 0;
  let deletedEntries = 0;
  let skippedAlreadyMigrated = 0;
  const errors: { thingsUuid: string; title: string; error: string }[] = [];

  for (const item of wishlistItems) {
    const dbItem = dbItemsByUuid.get(item.thingsUuid);
    if (!dbItem) continue;

    // Idempotence — pokud Todoist push v rámci remigrate už proběhl,
    // pushedTaskId obsahuje Todoist task ID (numerický). Pokud obsahuje
    // Entry CUID (cm... 25 znaků), je to ze starého wishlist→Knowledge flow.
    // Číselné Todoist ID = už remigrated, skip.
    if (dbItem.pushedTaskId && /^\d+$/.test(dbItem.pushedTaskId)) {
      skippedAlreadyMigrated++;
      continue;
    }

    try {
      // Najdi Entry + Recording pro cleanup
      const oldEntryId = dbItem.pushedTaskId; // CUID Entry.id
      let oldEntry: { id: string; recordingId: string } | null = null;
      if (oldEntryId) {
        oldEntry = await prisma.entry.findUnique({
          where: { id: oldEntryId },
          select: { id: true, recordingId: true },
        });
      }

      // Sestav labels z knowledgeCategory + knowledgeTags
      const labels: string[] = [];
      if (item.knowledgeCategory) labels.push(item.knowledgeCategory);
      if (Array.isArray(item.knowledgeTags)) labels.push(...item.knowledgeTags);
      // Slugify pro Todoist (lowercase, no spaces, max 30)
      const cleanLabels = labels
        .map((l) => l.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30))
        .filter(Boolean)
        .filter((l, i, arr) => arr.indexOf(l) === i); // dedup

      // Description = notes + URL pokud má
      const descParts: string[] = [];
      if (item.notes?.trim()) descParts.push(item.notes.trim());
      if (item.knowledgeUrl) descParts.push(`\n${item.knowledgeUrl}`);

      // Vytvoř Todoist task
      const todoistTask = await createTask(token, {
        content: item.title.slice(0, 500),
        description: descParts.join("\n").slice(0, 16000) || undefined,
        project_id: wishlistProject.todoistId,
        priority: 1, // Todoist 1 = nejnižší (wishlist)
        labels: cleanLabels,
      });

      // Updatuj ThingsImportItem
      await prisma.thingsImportItem.update({
        where: { id: dbItem.id },
        data: {
          pushedTaskId: todoistTask.id,
          pushedAt: new Date(),
          pushResult: "ok",
        },
      });

      // Smaž starou Knowledge entry + Recording
      if (oldEntry) {
        try {
          await prisma.entry.delete({ where: { id: oldEntry.id } });
          // Smaž Recording jen pokud nemá další entries (synthetic recordings
          // pro Things import mají typicky 1:1, ale check pro jistotu)
          const remaining = await prisma.entry.count({
            where: { recordingId: oldEntry.recordingId },
          });
          if (remaining === 0) {
            await prisma.recording.delete({ where: { id: oldEntry.recordingId } });
          }
          deletedEntries++;
        } catch {
          // OK když Entry mezitím zmizela
        }
      }

      createdTasks++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ thingsUuid: item.thingsUuid, title: item.title, error: msg });
    }
  }

  return Response.json({
    ok: true,
    summary: {
      wishlistTotal: wishlistItems.length,
      createdTasks,
      deletedEntries,
      skippedAlreadyMigrated,
      failed: errors.length,
    },
    todoistProject: {
      id: wishlistProject.todoistId,
      name: wishlistProject.name,
      created: createdProject,
    },
    errors: errors.slice(0, 20),
  });
};
