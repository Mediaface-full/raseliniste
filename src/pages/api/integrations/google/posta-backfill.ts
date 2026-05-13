/**
 * POST /api/integrations/google/posta-backfill
 *
 * Spousteni multi-tick backfillu historie Gmailu. Body: { years: 1|2|4|6|null }
 * (null = all dostupne).
 *
 * Idempotent: druhe volani prepise startedAt + reset progress (uzitecne kdyz
 * predchozi spadl s errorem a chceme restart).
 *
 * Pro on-demand tick (Petr nechce cekat 15 min na cron), pridava ?tick=1 query
 * — provede jeden tick hned po startu.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { startBackfill, backfillMetadataTick } from "@/lib/posta-sync";
import { prisma } from "@/lib/db";

export const prerender = false;

const Body = z.object({
  years: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.null()]),
});

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  await startBackfill(session.uid, parsed.years);

  // On-demand: prvni tick hned (jinak by Petr cekal max 15 min na cron)
  let firstTick = null;
  if (url.searchParams.get("tick") !== "0") {
    firstTick = await backfillMetadataTick(session.uid);
  }

  return Response.json({
    ok: true,
    years: parsed.years,
    firstTick,
  });
};

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: {
      gmailBackfillStartedAt: true,
      gmailBackfillCompletedAt: true,
      gmailBackfillYears: true,
      gmailBackfillTotalFetched: true,
      gmailBackfillError: true,
      gmailBackfillPageToken: true,
    },
  });

  return Response.json({
    ok: true,
    status: {
      started: !!user?.gmailBackfillStartedAt,
      completed: !!user?.gmailBackfillCompletedAt,
      inProgress: !!user?.gmailBackfillStartedAt && !user?.gmailBackfillCompletedAt,
      years: user?.gmailBackfillYears ?? null,
      totalFetched: user?.gmailBackfillTotalFetched ?? 0,
      error: user?.gmailBackfillError ?? null,
      startedAt: user?.gmailBackfillStartedAt?.toISOString() ?? null,
      completedAt: user?.gmailBackfillCompletedAt?.toISOString() ?? null,
    },
  });
};
