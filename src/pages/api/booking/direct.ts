import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { directBook } from "@/lib/booking";
import { prisma } from "@/lib/db";

export const prerender = false;

const Body = z.object({
  contactId: z.string().min(1),
  type: z.enum(["MEETING_ONLINE", "MEETING_PRAGUE", "MEETING_HOME"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(240),
  meetSource: z.enum(["CONTACT", "COMPANY", "NEW"]).nullable().optional(),
  publicNote: z.string().max(1000).optional(),
  internalNote: z.string().max(500).optional(),
  // Doplnění emailu ke kontaktu přímo z formuláře (stejně jako u pozvánky)
  contactEmail: z.string().email().optional(),
});

/**
 * POST /api/booking/direct (Gideon 2026-08-27) — schůzka zadaná napřímo:
 * Gideon zná termín, vybere kontakt + typ + čí Meet, rovnou vznikne Google
 * event a hostovi odejde pozvánkový mail s linkem a .ics. Kolize jen varují.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const b = parsed.data;

  try {
    if (b.contactEmail) {
      const c = await prisma.contact.findFirst({
        where: { id: b.contactId, userId: session.uid },
        select: { id: true, icloudUid: true, emails: { select: { id: true }, take: 1 } },
      });
      if (c && c.emails.length === 0) {
        await prisma.contactEmail.create({
          data: { contactId: c.id, email: b.contactEmail.toLowerCase(), label: "work" },
        });
        if (c.icloudUid) {
          const { pushContactToIcloud } = await import("@/lib/icloud-contacts");
          const push = await pushContactToIcloud(session.uid, c.id).catch((e) => ({
            ok: false as const, error: e instanceof Error ? e.message : String(e),
          }));
          if (!push.ok) console.warn(`[booking.direct] iCloud push emailu selhal (${c.id}):`, push.error);
        }
      }
    }

    // Server běží v TZ Europe/Prague (viz feedback_docker_timezone.md)
    const startsAt = new Date(`${b.date}T${b.time}:00`);
    const result = await directBook({
      contactId: b.contactId,
      type: b.type,
      startsAt,
      durationMin: b.durationMin,
      meetSource: b.meetSource ?? null,
      publicNote: b.publicNote?.trim() || undefined,
      internalNote: b.internalNote?.trim() || undefined,
    }, session.uid);

    console.log(`[booking.direct] CREATED invite=${result.inviteId} ${b.date} ${b.time} type=${b.type} meetSource=${b.meetSource ?? "auto"}`);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[booking.direct] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
