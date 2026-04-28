import type { APIRoute } from "astro";
import { z } from "zod";
import { env } from "@/lib/env";
import { parseEventText } from "@/lib/event-parser";
import { evaluateSlot } from "@/lib/rules";

export const prerender = false;

/**
 * POST /api/calendar/check
 * Auth: Bearer SIRI_API_TOKEN
 * Body: { freeText: string }
 *
 * Pro iOS Siri Shortcut „Hey Siri, zkontroluj termín".
 * Vrátí jen verdikt + krátký český text k přečtení Siri.
 * NEPÍŠE — commit musí proběhnout v /quickadd UI (vědomá pojistka proti misparsům).
 */
const schema = z.object({
  freeText: z.string().min(1).max(500),
});

export const POST: APIRoute = async ({ request }) => {
  const token = env.SIRI_API_TOKEN;
  if (!token) {
    return Response.json({ error: "SIRI_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== token) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ spoken: "Nerozuměl jsem." }, { status: 400 });
  }

  const result = await parseEventText(parsed.data.freeText);

  if (!result.parsed) {
    return Response.json({
      spoken: result.needsClarification ?? "Řekni místo, prosím.",
      canCommit: false,
      detail: null,
    });
  }

  const evaluation = await evaluateSlot({
    type: result.parsed.type,
    startsAt: new Date(result.parsed.startsAt),
    endsAt: new Date(result.parsed.endsAt),
    locationName: result.parsed.locationName,
  });

  let spoken: string;
  if (evaluation.verdict === "GREEN") {
    spoken = "Zelená. Můžeš.";
  } else if (evaluation.verdict === "YELLOW") {
    const first = evaluation.signals[0];
    spoken = `Žlutá. ${first ? first.message : "Pozor na něco."} Otevři Rašeliniště pro detail.`;
  } else {
    const first = evaluation.signals[0];
    spoken = `Červená. ${first ? first.message : "Nelze."}`;
  }

  return Response.json({
    spoken,
    canCommit: evaluation.verdict !== "RED",
    detail: { parsed: result.parsed, evaluation },
  });
};
