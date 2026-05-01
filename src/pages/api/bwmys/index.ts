import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  nazev: z.string().min(1).max(200),
  kontext: z.enum(["pracovni", "osobni", "smiseny"]),
  otazka: z.string().min(3).max(500),
  varianty: z.array(z.string().min(1).max(200)).min(3),
  predpoklady: z.array(z.string().min(1).max(300)).min(1),
  deadlineRozhodnuti: z.string(), // ISO date
  delkaSberuDny: z.number().int().min(1).max(180).optional(),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Filter dle status (?status=aktivni nebo ?archive=1 = uzavřená/odložená)
  const statusFilter = url.searchParams.get("status");
  const archive = url.searchParams.get("archive") === "1";

  const where: Record<string, unknown> = { userId: session.uid };
  if (statusFilter) where.status = statusFilter;
  else if (archive) where.status = { in: ["uzavrene_jdu", "uzavrene_nejdu", "odlozene", "archivovane"] };
  else where.status = "aktivni";

  const items = await prisma.decision.findMany({
    where,
    orderBy: archive ? { datumUzavreni: "desc" } : { datumVytvoreni: "desc" },
    include: {
      _count: { select: { entries: true, evaluations: true } },
    },
  });

  return Response.json({ items });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  // Otázka musí končit otazníkem (nebo obsahovat tvar otázky)
  const otazkaTrim = body.otazka.trim();
  if (!otazkaTrim.endsWith("?")) {
    return Response.json({ error: "Otázka musí končit otazníkem." }, { status: 400 });
  }

  const deadline = new Date(body.deadlineRozhodnuti);
  if (isNaN(deadline.getTime()) || deadline < new Date()) {
    return Response.json({ error: "Deadline musí být v budoucnosti." }, { status: 400 });
  }

  const item = await prisma.decision.create({
    data: {
      userId: session.uid,
      nazev: body.nazev.trim(),
      kontext: body.kontext,
      otazka: otazkaTrim,
      varianty: body.varianty.map((v) => v.trim()).filter(Boolean) as object,
      predpoklady: body.predpoklady.map((p) => p.trim()).filter(Boolean) as object,
      deadlineRozhodnuti: deadline,
      delkaSberuDny: body.delkaSberuDny ?? 14,
      status: "aktivni",
    },
  });

  return Response.json({ item });
};
