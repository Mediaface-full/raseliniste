/**
 * Cron `posta-fill-bodies` — 10min tick doplneni plnych tel mailu po backfill.
 *
 * Po backfillMetadataTick uklada jen subject/from/snippet (metadata-only).
 * Po Petruv cleanup v /posta/uklid se mazou junk maily, zbyle potrebuji
 * plne body pro klasifikaci/embedding/zobrazeni v UI.
 *
 * Tato uloha hleda EmailMessage with bodyText IS NULL (a bodyTextCiphertext NULL,
 * vsechny varianty body) a per-mail vola Gmail messages.get?format=full. Update row.
 *
 * Limit 100 mailu / tick (sleep 50ms = ~5s + Gmail API quota).
 */

import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { fillBodiesTick } from "@/lib/posta-sync";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const key = request.headers.get("x-cron-key");
  if (key !== env.CRON_SECRET) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Najdi usery kteri maji nejake metadata-only maily k doplneni
  const users = await prisma.user.findMany({
    where: {
      emailMessages: {
        some: {
          bodyText: null,
          bodyTextCiphertext: null,
          bodyHtml: null,
          bodyHtmlCiphertext: null,
        },
      },
    },
    select: { id: true },
  });

  if (users.length === 0) {
    return Response.json({ ok: true, message: "Žádné maily k doplnění.", users: 0 });
  }

  const results = [];
  for (const u of users) {
    const stats = await fillBodiesTick(u.id);
    results.push(stats);
  }

  return Response.json({ ok: true, users: users.length, results });
};
