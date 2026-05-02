import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { extractArguments, type DecisionForAi, type EntryForAi } from "@/lib/bwmys-ai";

export const prerender = false;

/**
 * POST /api/bwmys/[id]/arguments
 *   - Najde poslední finální DecisionEvaluation
 *   - Pokud má argumentsJson, vrátí ho (cache hit)
 *   - Jinak zavolá AI a uloží
 *   - ?force=1 vynutí regeneraci
 */
export const POST: APIRoute = async ({ request, cookies, params, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });
  void request;

  const force = url.searchParams.get("force") === "1";

  const decision = await prisma.decision.findFirst({
    where: { id, userId: session.uid },
    include: {
      entries: { orderBy: { datum: "asc" } },
      evaluations: { where: { typ: "finalni" }, orderBy: { datum: "desc" }, take: 1 },
    },
  });
  if (!decision) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  const lastFinal = decision.evaluations[0];
  if (!lastFinal) {
    return Response.json({ error: "Není finální vyhodnocení — argumenty se generují k němu." }, { status: 400 });
  }

  // Cache hit
  if (!force && lastFinal.argumentsJson) {
    return Response.json({ arguments: lastFinal.argumentsJson });
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

  const entriesForAi: EntryForAi[] = decision.entries.map((e) => ({
    datum: e.datum,
    nalada: e.nalada,
    typVstupu: e.typVstupu,
    uhelPohledu: e.uhelPohledu === "nevybrano" && e.uhelPohleduAi ? e.uhelPohleduAi : e.uhelPohledu,
    obsah: e.obsah,
  }));

  try {
    const args = await extractArguments(dForAi, entriesForAi);
    await prisma.decisionEvaluation.update({
      where: { id: lastFinal.id },
      data: { argumentsJson: args as unknown as object },
    });
    return Response.json({ arguments: args });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bwmys arguments]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
