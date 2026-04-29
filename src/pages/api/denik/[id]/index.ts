import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

async function ownEntry(userId: string, id: string) {
  return prisma.journalEntry.findFirst({ where: { id, userId } });
}

/**
 * GET /api/denik/:id — detail (pro polling z draft view)
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const entry = await ownEntry(session.uid, id);
  if (!entry) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json({ entry });
};

const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  bodyMarkdown: z.string().max(50_000).optional(),
  mood: z.enum(["ELATED", "CONTENT", "NEUTRAL", "TIRED", "STRESSED", "DOWN", "ANGRY", "MIXED"]).nullable().optional(),
  tags: z.array(z.string()).optional(),
  highlights: z.array(z.string()).optional(),
  audioRetainForever: z.boolean().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const owned = await ownEntry(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { ...parsed.data };
  if (parsed.data.date) data.date = new Date(`${parsed.data.date}T00:00:00`);

  const entry = await prisma.journalEntry.update({ where: { id }, data });
  return Response.json({ entry });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const owned = await ownEntry(session.uid, id);
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (owned.audioPath) await deleteUpload(owned.audioPath).catch(() => null);
  await prisma.journalEntry.delete({ where: { id } });
  return Response.json({ ok: true });
};
