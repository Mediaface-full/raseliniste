import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/push/filters  — vrátí aktuální per-source push filtry
 * PATCH /api/push/filters — update filtrů (libovolná podmnožina)
 *
 * Petr 2026-05-27: per-source toggles, ať Petr nedostává všechno najednou.
 * Default vše true (zachovat backward compat).
 */
const Schema = z.object({
  pushVip: z.boolean().optional(),
  pushUrgentEmail: z.boolean().optional(),
  pushStudankaGuest: z.boolean().optional(),
  pushBookingConfirmed: z.boolean().optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: {
      pushVip: true,
      pushUrgentEmail: true,
      pushStudankaGuest: true,
      pushBookingConfirmed: true,
    },
  });
  if (!user) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json(user);
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.uid },
    data: parsed.data,
    select: {
      pushVip: true,
      pushUrgentEmail: true,
      pushStudankaGuest: true,
      pushBookingConfirmed: true,
    },
  });

  return Response.json(updated);
};
