import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/denik?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
 *   List zápisů (default: posledních 30 dní, 50 limit).
 *
 * POST /api/denik   — manuální textový zápis (bez audia)
 *   Body: { date: YYYY-MM-DD, bodyMarkdown, title?, mood?, tags?, highlights? }
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId: session.uid };
  if (fromStr || toStr) {
    where.date = {};
    if (fromStr) where.date.gte = new Date(`${fromStr}T00:00:00`);
    if (toStr) where.date.lte = new Date(`${toStr}T23:59:59`);
  } else {
    const thirtyAgo = new Date();
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    thirtyAgo.setHours(0, 0, 0, 0);
    where.date = { gte: thirtyAgo };
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return Response.json({ entries });
};

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bodyMarkdown: z.string().min(1).max(50_000),
  title: z.string().max(200).nullable().optional(),
  mood: z.enum(["ELATED", "CONTENT", "NEUTRAL", "TIRED", "STRESSED", "DOWN", "ANGRY", "MIXED"]).nullable().optional(),
  tags: z.array(z.string()).optional(),
  highlights: z.array(z.string()).optional(),
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
  const date = new Date(`${d.date}T00:00:00`);

  const entry = await prisma.journalEntry.create({
    data: {
      userId: session.uid,
      date,
      bodyMarkdown: d.bodyMarkdown,
      title: d.title ?? null,
      mood: (d.mood ?? null) as never,
      tags: d.tags ?? [],
      highlights: d.highlights ?? [],
      status: "ready",
    },
  });

  return Response.json({ entry });
};
