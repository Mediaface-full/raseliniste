import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/calendar/events/:id/hide  (Petr 2026-05-27)
 *
 * Lokálně schová event z Rašeliniště UI = nastaví `deletedRemotely=true`.
 * Použij když je event smazán v Google ale sweep ho ještě nestihl označit,
 * nebo když je event jen z místních důvodů irelevantní.
 *
 * Žádné volání Google API — toto je čistě lokální „hide". Pokud event v
 * Google existuje, příští sync ho VRATÍ (= `upsertEvent` ho znovu zapíše
 * jako aktivní). Tedy: použij až poté co jsi smazal v Google appce.
 *
 * Pro skutečné smazání v Google viz /api/calendar/events/<id>/delete
 * (zatím neexistuje, dodělá se v dalším kroku pokud potřeba).
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.calendarEvent.update({
    where: { id },
    data: { deletedRemotely: true, lastSyncedAt: new Date() },
  });

  return Response.json({ ok: true, id });
};
