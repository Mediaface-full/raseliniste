import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const ALLOWED_TINTS = ["peach", "mint", "lavender", "sky", "sage", "butter", "rose", "pink"] as const;

const CreateBody = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url().max(2000),
  tint: z.enum(ALLOWED_TINTS).default("sky"),
  icon: z.string().max(60).optional().nullable(),
  order: z.number().int().optional(),
});

/**
 * GET /api/page-links — list všech linků daného uživatele, sortováno podle order
 * POST /api/page-links — vytvořit nový link
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const links = await prisma.pageLink.findMany({
    where: { userId: session.uid },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return Response.json({ links });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  // Default order = max + 1 (přidat na konec listu)
  let order = parsed.data.order;
  if (order === undefined) {
    const max = await prisma.pageLink.aggregate({
      where: { userId: session.uid },
      _max: { order: true },
    });
    order = (max._max.order ?? -1) + 1;
  }

  const link = await prisma.pageLink.create({
    data: {
      userId: session.uid,
      name: parsed.data.name.trim(),
      url: parsed.data.url.trim(),
      tint: parsed.data.tint,
      icon: parsed.data.icon?.trim() || null,
      order,
    },
  });

  return Response.json({ link });
};
