import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const ALLOWED_TINTS = ["peach", "mint", "lavender", "sky", "sage", "butter", "rose", "pink"] as const;

const PatchBody = z.object({
  name: z.string().min(1).max(60).optional(),
  url: z.string().url().max(2000).optional(),
  tint: z.enum(ALLOWED_TINTS).optional(),
  icon: z.string().max(60).nullable().optional(),
  order: z.number().int().optional(),
});

/**
 * PATCH /api/page-links/:id — update libovolnou podmnožinu fields
 * DELETE /api/page-links/:id — smazat link
 */
export const PATCH: APIRoute = async ({ request, params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const link = await prisma.pageLink.findUnique({ where: { id } });
  if (!link) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (link.userId !== session.uid) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.url !== undefined) data.url = parsed.data.url.trim();
  if (parsed.data.tint !== undefined) data.tint = parsed.data.tint;
  if (parsed.data.icon !== undefined) data.icon = parsed.data.icon?.trim() || null;
  if (parsed.data.order !== undefined) data.order = parsed.data.order;

  const updated = await prisma.pageLink.update({ where: { id }, data });
  return Response.json({ link: updated });
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const link = await prisma.pageLink.findUnique({ where: { id } });
  if (!link) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (link.userId !== session.uid) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  await prisma.pageLink.delete({ where: { id } });
  return Response.json({ ok: true });
};
