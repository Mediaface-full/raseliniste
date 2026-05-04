import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const prerender = false;

const Body = z.object({
  projectId: z.string().min(1),
  text: z.string().min(1).max(8000),
});

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_PER_GUEST = 30; // víc než pro audio (text je levnější, snazší překlepnout)

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

/**
 * POST /api/me/:token/note
 * Body: { projectId, text }
 *
 * Vytvoří ProjectRecording BEZ audia — host poslal jen textový vzkaz.
 * Není AI processing. status="processed" hned, transcript prázdný,
 * guestNote = text. Petr v admin UI vidí jako klasický recording v lavender
 * sekci "Textové info k projektu" (bez audio playeru).
 *
 * Důvod existence: host někdy nemůže nebo nechce nahrávat (hluk, prostředí,
 * slyšitelnost) ale potřebuje rychle poslat text — odkaz, jméno, číslo,
 * krátkou zprávu. Předtím šel jen jako příloha k audio nahrávce, takže host
 * bez nahrávky nedokázal nic odeslat.
 */
export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  const token = params.token;
  if (!token) return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });

  const guest = await prisma.guestUser.findUnique({ where: { guestToken: token } });
  if (!guest) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return Response.json(
      { error: "INVALID_INPUT", message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Rate limit per guest
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await prisma.projectRecording.count({
    where: { guestUserId: guest.id, createdAt: { gte: since } },
  });
  if (recentCount >= RATE_LIMIT_PER_GUEST) {
    return Response.json(
      { error: `Limit ${RATE_LIMIT_PER_GUEST} zpráv/hodinu vyčerpán. Zkus to za chvíli.` },
      { status: 429 },
    );
  }

  // Ověř invitation
  const invitation = await prisma.projectInvitation.findUnique({
    where: { projectId_guestUserId: { projectId: body.projectId, guestUserId: guest.id } },
    include: { project: { select: { id: true, archivedAt: true } } },
  });
  if (!invitation || invitation.project.archivedAt) {
    return Response.json({ error: "Nejsi pozván do tohoto projektu." }, { status: 403 });
  }

  const ip = clientIp(request, clientAddress);
  const ua = request.headers.get("user-agent") ?? null;

  const recording = await prisma.projectRecording.create({
    data: {
      projectId: body.projectId,
      guestUserId: guest.id,
      isOwner: false,
      authorName: guest.name,
      type: "STANDARD",
      // Bez audia — žádné soubory, jen text
      audioPath: null,
      audioMime: null,
      audioBytes: null,
      audioDurationSec: null,
      transcript: "", // žádný AI přepis
      guestNote: body.text.trim(),
      status: "processed", // bez AI processingu, hotovo hned
      ip,
      userAgent: ua,
    },
  });

  return Response.json({ ok: true, recordingId: recording.id });
};
