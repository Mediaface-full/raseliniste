import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { createInvite } from "@/lib/booking";
import { prisma } from "@/lib/db";

export const prerender = false;

const schema = z.object({
  contactId: z.string().nullable().optional(),
  mode: z.enum(["CLIENT", "FRIEND"]),
  meetingType: z.enum(["CHOICE_PRAGUE", "CHOICE_ONLINE", "CHOICE_HOME", "CHOICE_ANY"]),
  slotDurationMin: z.number().int().min(15).max(240).optional(),
  validityDays: z.number().int().min(1).max(90).optional(),
  internalNote: z.string().max(500).optional(),
  // Petr 2026-05-25: per-invite earliest slot. Akceptujeme ISO date (YYYY-MM-DD)
  // nebo plný ISO datetime. Prázdný string nebo null = žádné omezení.
  availableFrom: z.string().min(1).optional().nullable(),
});

/**
 * POST /api/booking/invite — admin (Petr) vytvoří invite
 * Vrátí { invite: {id, token}, url }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  try {
    // availableFrom: YYYY-MM-DD nebo plný ISO. Parse → Date, nebo null pokud
    // prázdné/v minulosti. Pokud Petr pošle jen datum, bere se 00:00 Europe/Prague.
    let availableFrom: Date | null = null;
    if (parsed.data.availableFrom && parsed.data.availableFrom.trim()) {
      const raw = parsed.data.availableFrom.trim();
      // YYYY-MM-DD → datetime 00:00 v Praha TZ (UTC+1/+2). Pro DST safety
      // sestavíme jako lokální midnight a JS Date to bere jako server-local
      // (v kontejneru je TZ=Europe/Prague — viz feedback_docker_timezone.md).
      const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(`${raw}T00:00:00`)
        : new Date(raw);
      if (!isNaN(d.getTime()) && d > new Date()) {
        availableFrom = d;
      }
    }
    const result = await createInvite({ ...parsed.data, availableFrom });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

/**
 * GET /api/booking/invite — admin (Petr) list všech invitů
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const invites = await prisma.bookingInvite.findMany({
    where: {
      // Schovej zrušené a expirované — Gideon je nepotřebuje vidět v listu.
      // Když chce historii, dohledá v DB. Aktivní jsou: PENDING/VIEWED/RESERVED/CONFIRMED.
      status: { notIn: ["CANCELED", "EXPIRED"] },
      // Plus skryj EVERGREEN šablonu pro /schuzka — to je interní template, ne pozvánka
      NOT: { internalNote: "schuzka-public-evergreen" },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      contact: { select: { id: true, displayName: true } },
    },
  });
  return Response.json({ invites });
};
