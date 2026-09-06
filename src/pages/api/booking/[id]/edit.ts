import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * PATCH /api/booking/:id/edit — úprava parametrů pozvánky, dokud si host
 * nevybral termín (Gideon 2026-08-05). Povoleno jen ve stavech
 * PENDING/VIEWED — po rezervaci už parametry mění realitu schůzky
 * (Google event, mail) a musí se řešit zrušením + novou pozvánkou.
 */
const Body = z.object({
  mode: z.enum(["CLIENT", "FRIEND"]).optional(),
  meetingType: z.enum(["CHOICE_PRAGUE", "CHOICE_ONLINE", "CHOICE_HOME", "CHOICE_ANY", "CHOICE_LUNCH_PRAGUE"]).optional(),
  slotDurationMin: z.number().int().min(15).max(240).optional(),
  // YYYY-MM-DD; "" / null = zrušit omezení
  availableFrom: z.string().nullable().optional(),
  // Gideon 2026-08-10: výjimečné povolení víkendových slotů
  allowWeekend: z.boolean().optional(),
  allowEvening: z.boolean().optional(),
  meetSource: z.enum(["CONTACT", "COMPANY", "NEW"]).nullable().optional(),
  // YYYY-MM-DD — konec platnosti (uloží se konec dne)
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  publicNote: z.string().max(1000).nullable().optional(),
  internalNote: z.string().max(500).nullable().optional(),
});

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }

  const invite = await prisma.bookingInvite.findUnique({ where: { id: params.id } });
  if (!invite) return Response.json({ error: "Pozvánka nenalezena." }, { status: 404 });
  if (invite.status !== "PENDING" && invite.status !== "VIEWED") {
    return Response.json(
      { error: `Pozvánku ve stavu ${invite.status} už nejde upravit — host si vybral termín. Zruš ji a vytvoř novou.` },
      { status: 400 },
    );
  }

  const b = parsed.data;
  const data: Record<string, unknown> = {};
  if (b.mode) data.mode = b.mode;
  if (b.meetingType) data.meetingType = b.meetingType;
  // Oběd má pevných 90 min (stejné pravidlo jako při vytvoření)
  if (b.slotDurationMin) data.slotDurationMin = b.meetingType === "CHOICE_LUNCH_PRAGUE" ? 90 : b.slotDurationMin;
  if (b.meetingType === "CHOICE_LUNCH_PRAGUE") data.slotDurationMin = 90;
  if (b.availableFrom !== undefined) {
    if (!b.availableFrom || !b.availableFrom.trim()) {
      data.availableFrom = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(b.availableFrom.trim())) {
      data.availableFrom = new Date(`${b.availableFrom.trim()}T00:00:00`);
    } else {
      return Response.json({ error: "availableFrom musí být datum YYYY-MM-DD." }, { status: 400 });
    }
  }
  if (b.validUntil) data.validUntil = new Date(`${b.validUntil}T23:59:59`);
  if (b.allowWeekend !== undefined) data.allowWeekend = b.allowWeekend;
  if (b.allowEvening !== undefined) data.allowEvening = b.allowEvening;
  if (b.meetSource !== undefined) data.meetSource = b.meetSource;
  if (b.publicNote !== undefined) data.publicNote = b.publicNote?.trim() || null;
  if (b.internalNote !== undefined) data.internalNote = b.internalNote?.trim() || null;

  if (Object.keys(data).length === 0) return Response.json({ error: "Žádná změna." }, { status: 400 });

  const updated = await prisma.bookingInvite.update({ where: { id: invite.id }, data });
  console.log(`[booking.edit] ${invite.id} upraveno: ${Object.keys(data).join(", ")}`);
  return Response.json({ ok: true, invite: { id: updated.id, status: updated.status } });
};
