import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const PatchBody = z.object({
  pattern: z.string().min(1).max(200).optional(),
  matchType: z.enum(["contains", "domain", "exact"]).optional(),
  label: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ request, params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const rule = await prisma.postaIgnoreRule.findUnique({ where: { id } });
  if (!rule) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (rule.userId !== session.uid) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.pattern !== undefined) {
    let p = parsed.data.pattern.trim();
    const mt = parsed.data.matchType ?? rule.matchType;
    if (mt === "domain") p = p.toLowerCase().replace(/^@/, "");
    else p = p.toLowerCase();
    data.pattern = p;
  }
  if (parsed.data.matchType !== undefined) data.matchType = parsed.data.matchType;
  if (parsed.data.label !== undefined) data.label = parsed.data.label?.trim() || null;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

  const updated = await prisma.postaIgnoreRule.update({ where: { id }, data });
  return Response.json({ rule: updated });
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const rule = await prisma.postaIgnoreRule.findUnique({ where: { id } });
  if (!rule) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (rule.userId !== session.uid) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  await prisma.postaIgnoreRule.delete({ where: { id } });
  return Response.json({ ok: true });
};
