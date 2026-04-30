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
    const result = await createInvite(parsed.data);
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
