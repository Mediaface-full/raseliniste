import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * POST /api/diagnose/calendar-cleanup
 *
 * Najde duplicitní CalendarEvent skupiny se STEJNÝM (source, externalId) —
 * což by nemělo existovat (je to bug v unique constraint). Pro každou skupinu
 * zachová záznam s nejnovějším lastSyncedAt a smaže ostatní.
 *
 * Cross-source duplikáty (stejný title + čas, ale různé source) NEMAŽE — to
 * jsou skutečně dva záznamy ze dvou kalendářů (např. Google + iCloud sdílený).
 *
 * Default DRY RUN — vrátí seznam co by smazal, bez skutečného delete. Pro
 * skutečný delete: ?confirm=1
 *
 * Také ověří unique constraint v Postgres a hlasí pokud chybí.
 */
export const POST: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const confirm = url.searchParams.get("confirm") === "1";

  // 1. Ověř unique index v Postgres (informativně)
  const indexCheck = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'CalendarEvent' AND indexdef LIKE '%externalId%'`,
  );

  // 2. Najdi duplikáty se stejným (source, externalId)
  const duplicateGroups = await prisma.$queryRawUnsafe<
    Array<{ source: string; externalId: string; cnt: bigint }>
  >(
    `SELECT source::text, "externalId", COUNT(*) as cnt
     FROM "CalendarEvent"
     WHERE "deletedRemotely" = false
     GROUP BY source, "externalId"
     HAVING COUNT(*) > 1
     ORDER BY cnt DESC`,
  );

  if (duplicateGroups.length === 0) {
    return Response.json({
      ok: true,
      message: "Žádné same-source duplikáty.",
      indexCheck,
    });
  }

  // 3. Pro každou skupinu vyhodnoť který záznam zachovat
  const plan: Array<{
    source: string;
    externalId: string;
    keep: { id: string; lastSyncedAt: string };
    remove: Array<{ id: string; lastSyncedAt: string }>;
  }> = [];

  for (const g of duplicateGroups) {
    const records = await prisma.calendarEvent.findMany({
      where: { source: g.source as never, externalId: g.externalId },
      select: { id: true, lastSyncedAt: true, title: true },
      orderBy: { lastSyncedAt: "desc" },
    });
    if (records.length < 2) continue;
    const [keep, ...rest] = records;
    plan.push({
      source: g.source,
      externalId: g.externalId,
      keep: { id: keep.id, lastSyncedAt: keep.lastSyncedAt.toISOString() },
      remove: rest.map((r) => ({
        id: r.id,
        lastSyncedAt: r.lastSyncedAt.toISOString(),
      })),
    });
  }

  const totalToRemove = plan.reduce((sum, p) => sum + p.remove.length, 0);

  if (!confirm) {
    return Response.json({
      ok: true,
      dryRun: true,
      message: `DRY RUN: smazalo by se ${totalToRemove} duplikátů ve ${plan.length} skupinách. Spusť s ?confirm=1 pro skutečný delete.`,
      indexCheck,
      plan,
    });
  }

  // 4. Skutečný delete v jedné transakci
  const idsToRemove = plan.flatMap((p) => p.remove.map((r) => r.id));
  const deleted = await prisma.calendarEvent.deleteMany({
    where: { id: { in: idsToRemove } },
  });

  return Response.json({
    ok: true,
    dryRun: false,
    deleted: deleted.count,
    groups: plan.length,
    indexCheck,
  });
};
