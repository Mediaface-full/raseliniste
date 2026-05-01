import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  nalada: z.number().int().min(1).max(5),
  typVstupu: z.enum(["novy_fakt_zvenci", "nova_uvaha", "napadlo_me", "reakce_na_udalost"]),
  uhelPohledu: z.enum(["fakta", "emoce", "kritika", "prinosy", "alternativy", "meta", "nevybrano"]).optional(),
  obsah: z.string().min(1).max(5000),
});

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const decisionId = params.id;
  if (!decisionId) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const owned = await prisma.decision.findFirst({ where: { id: decisionId, userId: session.uid } });
  if (!owned) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (owned.status !== "aktivni") {
    return Response.json({ error: "Rozhodnutí už není aktivní — zápis nelze přidat." }, { status: 400 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  const entry = await prisma.decisionEntry.create({
    data: {
      decisionId,
      nalada: body.nalada,
      typVstupu: body.typVstupu,
      uhelPohledu: body.uhelPohledu ?? "nevybrano",
      obsah: body.obsah.trim(),
    },
  });

  // Backend warnings (frontend si je zobrazí)
  const now = new Date();
  const sberHorizon = new Date(owned.datumVytvoreni.getTime() + owned.delkaSberuDny * 86400000);
  const warnings: string[] = [];
  if (now > owned.deadlineRozhodnuti) warnings.push("Deadline minul — zvaž finální vyhodnocení.");
  else if (now > sberHorizon) warnings.push("Plánovaná délka sběru uplynula — zvaž finální vyhodnocení.");

  return Response.json({ entry, warnings });
};
