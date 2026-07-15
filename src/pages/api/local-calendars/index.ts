import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { importIcsCalendar } from "@/lib/local-ics";

export const prerender = false;

// ICS text posílá klient jako JSON (soubor přečte FileReaderem) — žádný multipart
const uploadSchema = z.object({
  name: z.string().max(120),
  filename: z.string().max(255),
  icsText: z.string().min(1).max(5 * 1024 * 1024), // 5 MB strop
  calendarId: z.string().optional(), // re-upload = replace obsahu
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const calendars = await prisma.localCalendar.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, filename: true, eventCount: true, createdAt: true, updatedAt: true },
  });
  return Response.json({ calendars });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const { name, filename, icsText, calendarId } = parsed.data;

  if (calendarId) {
    const existing = await prisma.localCalendar.findUnique({ where: { id: calendarId }, select: { id: true } });
    if (!existing) return Response.json({ error: "Kalendář nenalezen." }, { status: 404 });
  }

  try {
    const result = await importIcsCalendar({ name, filename, icsText, existingId: calendarId });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[local-ics] import failed:", err);
    return Response.json(
      { error: "Soubor se nepodařilo přečíst — je to platný .ics export?" },
      { status: 400 },
    );
  }
};
