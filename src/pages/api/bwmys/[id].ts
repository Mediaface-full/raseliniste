import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const PatchBody = z.object({
  nazev: z.string().min(1).max(200).optional(),
  kontext: z.enum(["pracovni", "osobni", "smiseny"]).optional(),
  otazka: z.string().min(3).max(500).optional(),
  varianty: z.array(z.string().min(1)).min(3).optional(),
  predpoklady: z.array(z.string().min(1)).min(1).optional(),
  deadlineRozhodnuti: z.string().optional(),
  delkaSberuDny: z.number().int().min(1).max(180).optional(),
  status: z.enum(["aktivni", "uzavrene_jdu", "uzavrene_nejdu", "odlozene", "archivovane"]).optional(),
  verdiktText: z.string().max(5000).nullable().optional(),
  coByZmeniloVerdikt: z.string().max(2000).nullable().optional(),
  datumRevize: z.string().nullable().optional(),
  odlozenoDo: z.string().nullable().optional(),
});

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  // Defenzivní cleanup stuck processing — pokud AI pipeline crashla nebo
  // kontejner se restartoval během běhu, processing rows by zůstaly
  // navždy s loaderem v UI. Po 5 minutách je automaticky překlopíme na error.
  const STALE_AFTER_MS = 5 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);
  await prisma.decisionEvaluation.updateMany({
    where: {
      decision: { id, userId: session.uid },
      status: "processing",
      datum: { lt: staleCutoff },
    },
    data: {
      status: "error",
      processingError: "AI pipeline nestihla doběhnout do 5 minut. Smaž tuto evaluaci a zkus znovu.",
    },
  });
  await prisma.decisionEntry.updateMany({
    where: {
      decision: { id, userId: session.uid },
      status: "processing",
      datum: { lt: staleCutoff },
    },
    data: {
      status: "error",
      processingError: "Audio AI pipeline nestihla doběhnout do 5 minut.",
    },
  });

  const item = await prisma.decision.findFirst({
    where: { id, userId: session.uid },
    include: {
      entries: { orderBy: { datum: "asc" } },
      evaluations: { orderBy: { datum: "desc" } },
      reopenings: { orderBy: { datum: "desc" } },
    },
  });
  if (!item) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  return Response.json({ item });
};

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await prisma.decision.findFirst({ where: { id, userId: session.uid } });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.nazev !== undefined) data.nazev = body.nazev.trim();
  if (body.kontext !== undefined) data.kontext = body.kontext;
  if (body.otazka !== undefined) data.otazka = body.otazka.trim();
  if (body.varianty !== undefined) data.varianty = body.varianty;
  if (body.predpoklady !== undefined) data.predpoklady = body.predpoklady;
  if (body.deadlineRozhodnuti !== undefined) data.deadlineRozhodnuti = new Date(body.deadlineRozhodnuti);
  if (body.delkaSberuDny !== undefined) data.delkaSberuDny = body.delkaSberuDny;
  if (body.verdiktText !== undefined) data.verdiktText = body.verdiktText;
  if (body.coByZmeniloVerdikt !== undefined) data.coByZmeniloVerdikt = body.coByZmeniloVerdikt;
  if (body.datumRevize !== undefined) data.datumRevize = body.datumRevize ? new Date(body.datumRevize) : null;
  if (body.odlozenoDo !== undefined) data.odlozenoDo = body.odlozenoDo ? new Date(body.odlozenoDo) : null;

  // Status změna — auto-doplnit datumUzavreni
  if (body.status !== undefined) {
    data.status = body.status;
    if (body.status === "uzavrene_jdu" || body.status === "uzavrene_nejdu") {
      data.datumUzavreni = new Date();
    } else if (body.status === "aktivni") {
      data.datumUzavreni = null;
    }
  }

  const item = await prisma.decision.update({ where: { id }, data });
  return Response.json({ item });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await prisma.decision.findFirst({ where: { id, userId: session.uid } });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.decision.delete({ where: { id } });
  return Response.json({ ok: true });
};
