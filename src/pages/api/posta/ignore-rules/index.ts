import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const CreateBody = z.object({
  pattern: z.string().min(1).max(200),
  matchType: z.enum(["contains", "domain", "exact"]).default("contains"),
  label: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const rules = await prisma.postaIgnoreRule.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ rules });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  // Normalizace patternu: trim + lowercase pro contains/exact, lowercase + bez @ pro domain
  let pattern = parsed.data.pattern.trim();
  if (parsed.data.matchType === "domain") {
    pattern = pattern.toLowerCase().replace(/^@/, "");
  } else {
    pattern = pattern.toLowerCase();
  }

  const rule = await prisma.postaIgnoreRule.create({
    data: {
      userId: session.uid,
      pattern,
      matchType: parsed.data.matchType,
      label: parsed.data.label?.trim() || null,
      enabled: parsed.data.enabled ?? true,
    },
  });
  return Response.json({ rule });
};
