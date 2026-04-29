import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * DELETE /api/denik/:id/audio — smaže jen audio soubor, zápis ponechá.
 * Užitečné když Petr chce zápis archivovat ale audio už nepotřebuje.
 */
export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const entry = await prisma.journalEntry.findFirst({ where: { id, userId: session.uid } });
  if (!entry) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (entry.audioPath) {
    await deleteUpload(entry.audioPath).catch(() => null);
  }

  await prisma.journalEntry.update({
    where: { id },
    data: {
      audioPath: null,
      audioBytes: null,
      audioMime: null,
      audioDeletedAt: new Date(),
    },
  });

  return Response.json({ ok: true });
};
