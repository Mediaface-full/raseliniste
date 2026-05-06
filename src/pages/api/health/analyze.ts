import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { analyzeHealth } from "@/lib/health-analyze";

export const prerender = false;

const Body = z.object({
  from: z.string(),
  to: z.string(),
  focus: z.string().max(1000).nullable().optional(),
});

const DAILY_LIMIT = 10;
const rateLimitMap = new Map<string, number[]>();
const DAY_MS = 24 * 60 * 60 * 1000;

function checkRate(userId: string): boolean {
  const now = Date.now();
  const list = (rateLimitMap.get(userId) ?? []).filter((t) => now - t < DAY_MS);
  if (list.length >= DAILY_LIMIT) {
    rateLimitMap.set(userId, list);
    return false;
  }
  list.push(now);
  rateLimitMap.set(userId, list);
  return true;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const from = new Date(body.from);
  const to = new Date(body.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return Response.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (to.getTime() < from.getTime()) {
    return Response.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > 400) {
    return Response.json({ error: "RANGE_TOO_LONG", maxDays: 400 }, { status: 400 });
  }

  if (!checkRate(session.uid)) {
    return Response.json({ error: "RATE_LIMITED", limit: DAILY_LIMIT, window: "24h" }, { status: 429 });
  }

  // Fire-and-forget — Gemini Pro analýza zdraví trvá 30-90 s, browser by timeoval.
  // Hned vytvoříme placeholder s status=processing a vrátíme ID; UI polluje.
  const placeholder = await prisma.healthAnalysis.create({
    data: {
      userId: session.uid,
      periodFrom: from,
      periodTo: to,
      focus: body.focus ?? null,
      trigger: "MANUAL",
      text: "",
      model: "gemini-2.5-pro",
      status: "processing",
    },
    select: { id: true, createdAt: true },
  });

  void runHealthAnalysis(placeholder.id, session.uid, from, to, body.focus ?? null);

  return Response.json({
    id: placeholder.id,
    createdAt: placeholder.createdAt,
    status: "processing",
    processing: true,
  });
};

// Module-level Set anti-GC pinning pro fire-and-forget pipeline
const inFlight = new Set<Promise<void>>();

async function runHealthAnalysis(
  analysisId: string,
  userId: string,
  from: Date,
  to: Date,
  focus: string | null,
): Promise<void> {
  const p = (async () => {
    try {
      const result = await analyzeHealth(userId, from, to, focus);
      await prisma.healthAnalysis.update({
        where: { id: analysisId },
        data: {
          text: result.text,
          model: result.meta.model,
          promptChars: result.meta.promptChars,
          totalSamples: result.meta.totalSamples,
          metricsWithData: result.meta.metricsWithData,
          status: "ready",
          processingError: null,
        },
      });
      console.log(`[health analyze bg] ${analysisId} processed OK`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[health analyze bg] ${analysisId} failed:`, msg);
      try {
        await prisma.healthAnalysis.update({
          where: { id: analysisId },
          data: { status: "error", processingError: msg.slice(0, 1000) },
        });
      } catch {}
    } finally {
      inFlight.delete(p);
    }
  })();
  inFlight.add(p);
  return p;
}
