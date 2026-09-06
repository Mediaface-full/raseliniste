import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { createInvite } from "@/lib/booking";
import { prisma } from "@/lib/db";

export const prerender = false;

const schema = z.object({
  contactId: z.string().nullable().optional(),
  mode: z.enum(["CLIENT", "FRIEND"]),
  // FIX 2026-08-05: chyběl CHOICE_LUNCH_PRAGUE (typ existuje od 2026-06-19)
  // — vytvoření pozvánky „Oběd v Praze" padalo na 400 invalid input.
  meetingType: z.enum(["CHOICE_PRAGUE", "CHOICE_ONLINE", "CHOICE_HOME", "CHOICE_ANY", "CHOICE_LUNCH_PRAGUE"]),
  slotDurationMin: z.number().int().min(15).max(240).optional(),
  validityDays: z.number().int().min(1).max(90).optional(),
  internalNote: z.string().max(500).optional(),
  publicNote: z.string().max(1000).optional(),
  // Petr 2026-05-25: per-invite earliest slot. Akceptujeme ISO date (YYYY-MM-DD)
  // nebo plný ISO datetime. Prázdný string nebo null = žádné omezení.
  availableFrom: z.string().min(1).optional().nullable(),
  // Gideon 2026-08-10: výjimečné povolení víkendových slotů pro tuhle pozvánku
  allowWeekend: z.boolean().optional(),
  allowEvening: z.boolean().optional(),
  // Gideon 2026-08-24: čí Meet u online schůzky (kontaktní / firemní místnost)
  meetSource: z.enum(["CONTACT", "COMPANY", "NEW"]).nullable().optional(),
  // Gideon 2026-08-04 („chci aby to fungovalo"): kontakt bez emailu už
  // neblokuje — email se zadá rovnou v pozvánce a uloží se KE KONTAKTU
  // (+ push do iCloudu), pak se pozvánka normálně vytvoří.
  contactEmail: z.string().email().optional(),
});

/**
 * POST /api/booking/invite — admin (Petr) vytvoří invite
 * Vrátí { invite: {id, token}, url }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) {
    console.warn("[booking.invite] POST 401 — UNAUTHENTICATED (cookies expired?)");
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.warn("[booking.invite] POST 400 — invalid input:", parsed.error.issues);
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  // Petr 2026-05-27: log každý pokus o vytvoření, ať máme stopu když Petr
  // nahlásí „pozvánky se neuložily". Předtím Astro logoval jen errors a 401 ne.
  console.log(
    `[booking.invite] POST — contactId=${parsed.data.contactId ?? "null"} mode=${parsed.data.mode} ` +
    `meetingType=${parsed.data.meetingType} availableFrom=${parsed.data.availableFrom ?? "none"}`,
  );

  try {
    // Doplnění emailu ke kontaktu přímo z pozvánky (jen když žádný nemá —
    // existující email má přednost). Push do iCloudu nesmí shodit vytvoření
    // pozvánky: selhání jen zalogujeme, DB email už drží.
    if (parsed.data.contactId && parsed.data.contactEmail) {
      const c = await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, userId: session.uid },
        select: { id: true, icloudUid: true, emails: { select: { id: true }, take: 1 } },
      });
      if (c && c.emails.length === 0) {
        await prisma.contactEmail.create({
          data: { contactId: c.id, email: parsed.data.contactEmail.toLowerCase(), label: "work" },
        });
        console.log(`[booking.invite] email doplněn ke kontaktu ${c.id} z pozvánky`);
        if (c.icloudUid) {
          const { pushContactToIcloud } = await import("@/lib/icloud-contacts");
          const push = await pushContactToIcloud(session.uid, c.id).catch((e) => ({
            ok: false as const, error: e instanceof Error ? e.message : String(e),
          }));
          if (!push.ok) console.warn(`[booking.invite] iCloud push emailu selhal (${c.id}):`, push.error);
        }
      }
    }

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
    console.log(`[booking.invite] CREATED id=${result.invite.id} token=${result.invite.token.slice(0, 8)}…`);
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[booking.invite] POST 500 — createInvite failed:`, msg);
    return Response.json({ error: msg }, { status: 500 });
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
      // Petr 2026-05-27: BUG FIX — předtím `NOT: { internalNote: "schuzka-..." }`
      // skrýval kvůli SQL NULL three-valued logic VŠECHNY invites kde
      // internalNote IS NULL (drtivá většina). Petr vytvořil 10 invitů, viděl jen 3.
      // Fix: explicit OR (NULL je OK, nebo != evergreen).
      OR: [
        { internalNote: null },
        { internalNote: { not: "schuzka-public-evergreen" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      contact: { select: { id: true, displayName: true } },
    },
  });
  return Response.json({ invites });
};
