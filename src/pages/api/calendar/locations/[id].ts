import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  aliases: z.array(z.string()).optional(),
  commuteMinPeak: z.number().int().min(0).max(600).optional(),
  commuteMinOff: z.number().int().min(0).max(600).optional(),
  isLocal: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const location = await prisma.location.update({
      where: { id },
      data: parsed.data,
    });
    return Response.json({ location });
  } catch {
    return Response.json({ error: "Lokace nenalezena" }, { status: 404 });
  }
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const id = params.id as string;
  try {
    // Pokud na ni odkazují CalendarEvent, prisma vrátí FK error.
    await prisma.location.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("foreign key")) {
      return Response.json(
        { error: "Lokace je použita v existujících událostech, nelze smazat." },
        { status: 409 },
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
};
