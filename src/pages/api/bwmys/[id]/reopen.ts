import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  popisNovehoFaktu: z.string().min(5).max(2000),
  schvaleno: z.boolean(),
  novyDeadline: z.string().optional(), // pokud chce posunout, jinak +14 dní
});

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await prisma.decision.findFirst({ where: { id, userId: session.uid } });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (owned.status === "aktivni") {
    return Response.json({ error: "Toto rozhodnutí je už aktivní." }, { status: 400 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  if (!body.schvaleno) {
    return Response.json({ error: "Musíš potvrdit, že je to opravdu nový fakt." }, { status: 400 });
  }

  const novyDeadline = body.novyDeadline
    ? new Date(body.novyDeadline)
    : new Date(Date.now() + 14 * 86400000);

  await prisma.decisionReopening.create({
    data: {
      decisionId: id,
      popisNovehoFaktu: body.popisNovehoFaktu.trim(),
      schvaleno: true,
    },
  });

  const item = await prisma.decision.update({
    where: { id },
    data: {
      status: "aktivni",
      datumUzavreni: null,
      deadlineRozhodnuti: novyDeadline,
    },
  });

  return Response.json({ ok: true, item });
};
