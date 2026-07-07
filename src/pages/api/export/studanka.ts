import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

export const prerender = false;

/**
 * Petr 2026-07-06: pull API pro externí systém (SRO Manager).
 *
 * GET /api/export/studanka?client=<externalClientRef>&since=<ISO date>&limit=50
 * Authorization: Bearer <STUDANKA_EXPORT_TOKEN>
 *
 * Vrací přepsané nahrávky projektů spárovaných s daným klientem
 * (ProjectBox.externalClientRef). Bez `client` param vrací vše co má
 * externalClientRef vyplněný (pro initial sync všech klientů najednou).
 *
 * Použití: backfill historie + ad-hoc dotaz při otevření karty klienta.
 * Live tok řeší webhook (studanka-webhook.ts) — tenhle endpoint je doplněk.
 *
 * Auth: globální token v env STUDANKA_EXPORT_TOKEN (openssl rand -hex 24).
 * Endpoint je na middleware public whitelistu — auth řeší sám.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const token = env.STUDANKA_EXPORT_TOKEN;
  if (!token) {
    return Response.json({ error: "EXPORT_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${token}`) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const clientRef = url.searchParams.get("client");
  const sinceRaw = url.searchParams.get("since");
  const untilRaw = url.searchParams.get("until"); // exclusive — pro stránkování desc (backfill)
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);

  let since: Date | undefined;
  if (sinceRaw) {
    const d = new Date(sinceRaw);
    if (isNaN(d.getTime())) {
      return Response.json({ error: "INVALID_SINCE — použij ISO 8601 (2026-07-01 nebo 2026-07-01T00:00:00Z)" }, { status: 400 });
    }
    since = d;
  }
  let until: Date | undefined;
  if (untilRaw) {
    const d = new Date(untilRaw);
    if (isNaN(d.getTime())) {
      return Response.json({ error: "INVALID_UNTIL — použij ISO 8601" }, { status: 400 });
    }
    until = d;
  }

  const recordings = await prisma.projectRecording.findMany({
    where: {
      status: "processed",
      transcript: { not: "" },
      ...(since || until
        ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } }
        : {}),
      project: clientRef
        ? { externalClientRef: clientRef }
        : { externalClientRef: { not: null } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: { select: { id: true, name: true, externalClientRef: true } },
      guestUser: { select: { name: true } },
    },
  });

  const items = recordings.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const analysis = r.analysis as any;
    return {
      recordingId: r.id,
      projectId: r.project.id,
      projectName: r.project.name,
      clientRef: r.project.externalClientRef,
      recordingType: r.type,
      guestName: r.guestUser?.name ?? null,
      durationSec: r.audioDurationSec ?? null,
      transcript: r.transcript,
      summary: typeof analysis?.summary === "string" ? analysis.summary : null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return Response.json({ ok: true, count: items.length, items });
};
