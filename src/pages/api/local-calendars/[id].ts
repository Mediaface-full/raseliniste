import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/** DELETE /api/local-calendars/:id — smaže kalendář, CASCADE smaže jeho události */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "Chybí id." }, { status: 400 });

  const existing = await prisma.localCalendar.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return Response.json({ error: "Kalendář nenalezen." }, { status: 404 });

  await prisma.localCalendar.delete({ where: { id } });
  return Response.json({ ok: true });
};
