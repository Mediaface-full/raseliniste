import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { createProject, createLabel } from "@/lib/todoist";

export const prerender = false;

const Body = z.object({
  projects: z
    .array(z.object({
      name: z.string().min(1).max(120),
      parentName: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
    }))
    .default([]),
  labels: z
    .array(z.object({
      name: z.string().min(1).max(60),
      color: z.string().nullable().optional(),
    }))
    .default([]),
});

interface ProjectResult { name: string; id: string; created: boolean; error?: string }
interface LabelResult { name: string; id: string; created: boolean; error?: string }

/**
 * POST /api/todoist/bulk-setup
 *
 * Bulk vytvoření projektů a labelů. Idempotentní — pokud existuje stejné jméno
 * (case-insensitive), vrátí existující ID bez volání Todoist API.
 *
 * Pořadí: projekty se vytváří v pořadí dodání. Pokud má položka `parentName`,
 * očekává se že parent byl vytvořen dřív v batch nebo už existuje v mirroru.
 *
 * Body: { projects: [{name, parentName?, color?}], labels: [{name, color?}] }
 *
 * Vrátí: { projects: ProjectResult[], labels: LabelResult[] }
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

  const token = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  // ===== PROJECTS =====
  const projectResults: ProjectResult[] = [];
  for (const p of body.projects) {
    try {
      const existing = await prisma.todoistProjectMirror.findFirst({
        where: { userId: session.uid, name: { equals: p.name, mode: "insensitive" } },
      });
      if (existing) {
        projectResults.push({ name: p.name, id: existing.todoistId, created: false });
        continue;
      }

      let parentId: string | null = null;
      if (p.parentName) {
        const parent = await prisma.todoistProjectMirror.findFirst({
          where: { userId: session.uid, name: { equals: p.parentName, mode: "insensitive" } },
        });
        if (!parent) {
          projectResults.push({
            name: p.name,
            id: "",
            created: false,
            error: `Parent "${p.parentName}" nenalezen.`,
          });
          continue;
        }
        parentId = parent.todoistId;
      }

      const created = await createProject(token, {
        name: p.name,
        parentId,
        color: p.color ?? null,
      });

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

      projectResults.push({ name: p.name, id: created.id, created: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      projectResults.push({ name: p.name, id: "", created: false, error: msg });
    }
  }

  // ===== LABELS =====
  const labelResults: LabelResult[] = [];
  for (const l of body.labels) {
    try {
      const existing = await prisma.todoistLabelMirror.findFirst({
        where: { userId: session.uid, name: { equals: l.name, mode: "insensitive" } },
      });
      if (existing) {
        labelResults.push({ name: l.name, id: existing.todoistId, created: false });
        continue;
      }

      const created = await createLabel(token, { name: l.name, color: l.color ?? null });

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

      labelResults.push({ name: l.name, id: created.id, created: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      labelResults.push({ name: l.name, id: "", created: false, error: msg });
    }
  }

  return Response.json({
    projects: projectResults,
    labels: labelResults,
    summary: {
      projectsTotal: projectResults.length,
      projectsCreated: projectResults.filter((r) => r.created).length,
      projectsExisting: projectResults.filter((r) => !r.created && !r.error).length,
      projectsFailed: projectResults.filter((r) => r.error).length,
      labelsTotal: labelResults.length,
      labelsCreated: labelResults.filter((r) => r.created).length,
      labelsExisting: labelResults.filter((r) => !r.created && !r.error).length,
      labelsFailed: labelResults.filter((r) => r.error).length,
    },
  });
};
