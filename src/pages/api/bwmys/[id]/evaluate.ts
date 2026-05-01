import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { miniVyhodnoceni, finalniVyhodnoceni, klasifikujUhly, type DecisionForAi, type EntryForAi, type UhelPohledu } from "@/lib/bwmys-ai";

export const prerender = false;

const Body = z.object({
  typ: z.enum(["prubezne", "finalni"]),
  forceLowSample: z.boolean().optional(), // přepíše varování pokud < 5 zápisů u finálního
});

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const decision = await prisma.decision.findFirst({
    where: { id, userId: session.uid },
    include: { entries: { orderBy: { datum: "asc" } } },
  });
  if (!decision) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Validace minima zápisů
  if (body.typ === "prubezne" && decision.entries.length < 3) {
    return Response.json({ error: "Pro průběžný náhled je potřeba alespoň 3 zápisy." }, { status: 400 });
  }
  if (body.typ === "finalni" && decision.entries.length < 5 && !body.forceLowSample) {
    return Response.json({
      error: "Podklady jsou slabé (< 5 zápisů). Pošli znovu s forceLowSample=true pokud chceš pokračovat.",
      lowSample: true,
    }, { status: 400 });
  }

  const dForAi: DecisionForAi = {
    nazev: decision.nazev,
    kontext: decision.kontext as "pracovni" | "osobni" | "smiseny",
    otazka: decision.otazka,
    varianty: decision.varianty as string[],
    predpoklady: decision.predpoklady as string[],
    deadlineRozhodnuti: decision.deadlineRozhodnuti,
    delkaSberuDny: decision.delkaSberuDny,
  };

  // Klasifikace nevybraných úhlů (jen pro finální, ať mini je rychlé)
  let entriesForAi: EntryForAi[] = decision.entries.map((e) => ({
    datum: e.datum,
    nalada: e.nalada,
    typVstupu: e.typVstupu,
    uhelPohledu: e.uhelPohledu,
    obsah: e.obsah,
  }));

  if (body.typ === "finalni") {
    const nevybraneIdx: number[] = [];
    const obsahyKKlasifikaci: string[] = [];
    decision.entries.forEach((e, i) => {
      if (e.uhelPohledu === "nevybrano" && !e.uhelPohleduAi) {
        nevybraneIdx.push(i);
        obsahyKKlasifikaci.push(e.obsah);
      }
    });

    if (obsahyKKlasifikaci.length > 0) {
      try {
        const klasifikace = await klasifikujUhly(obsahyKKlasifikaci);
        // Update DB + entriesForAi
        for (let k = 0; k < klasifikace.length; k++) {
          const idx = nevybraneIdx[k];
          const entry = decision.entries[idx];
          await prisma.decisionEntry.update({
            where: { id: entry.id },
            data: { uhelPohleduAi: klasifikace[k] },
          });
          entriesForAi[idx].uhelPohledu = klasifikace[k];
        }
      } catch (e) {
        console.warn("[bwmys] klasifikace selhala, pokračuji bez ní:", e);
      }
    } else {
      // Použij i existující uhelPohleduAi
      decision.entries.forEach((e, i) => {
        if (e.uhelPohledu === "nevybrano" && e.uhelPohleduAi) {
          entriesForAi[i].uhelPohledu = e.uhelPohleduAi as UhelPohledu;
        }
      });
    }
  }

  try {
    const obsah = body.typ === "prubezne"
      ? await miniVyhodnoceni(dForAi, entriesForAi)
      : await finalniVyhodnoceni(dForAi, entriesForAi);

    const evaluation = await prisma.decisionEvaluation.create({
      data: {
        decisionId: id,
        typ: body.typ,
        obsahStrukturovany: obsah as unknown as object,
        pocetVstupuVDobeGenerovani: decision.entries.length,
        modelName: "gemini-2.5-pro",
      },
    });
    return Response.json({ evaluation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bwmys evaluate]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
