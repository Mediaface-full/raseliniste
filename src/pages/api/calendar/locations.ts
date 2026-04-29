import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const createSchema = z.object({
  name: z.string().min(1).max(100),
  aliases: z.array(z.string()).optional(),
  commuteMinPeak: z.number().int().min(0).max(600),
  commuteMinOff: z.number().int().min(0).max(600),
  isLocal: z.boolean().optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const locations = await prisma.location.findMany({
    orderBy: { name: "asc" },
  });
  return Response.json({ locations });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  try {
    const location = await prisma.location.create({
      data: {
        name: parsed.data.name,
        aliases: parsed.data.aliases ?? [],
        commuteMinPeak: parsed.data.commuteMinPeak,
        commuteMinOff: parsed.data.commuteMinOff,
        isLocal: parsed.data.isLocal ?? false,
      },
    });
    return Response.json({ location });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique")) {
      return Response.json({ error: "Lokace s tímto názvem už existuje." }, { status: 409 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
};
