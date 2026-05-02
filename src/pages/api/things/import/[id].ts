import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

/**
 * GET /api/things/import/:id
 *  ?includeItems=true → vrátí i pole items s pushResult/pushedTaskId pro debug
 *
 * DELETE /api/things/import/:id
 *  Smaže import (kaskádově items). Lze jen pokud status != executing.
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const imp = await prisma.thingsImport.findFirst({
    where: { id, userId: session.uid },
    include: {
      items: url.searchParams.get("includeItems") === "true",
    },
  });
  if (!imp) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Aggregované counts
  const itemAgg = await prisma.thingsImportItem.groupBy({
    by: ["pushResult"],
    where: { importId: id },
    _count: true,
  });
  const counts = {
    total: imp.totalCount,
    migrate: imp.migrateCount,
    wishlist: imp.wishlistCount,
    discard: imp.discardCount,
    pushedOk: itemAgg.find((a) => a.pushResult === "ok")?._count ?? 0,
    pushedSkipped: itemAgg.find((a) => a.pushResult === "skipped")?._count ?? 0,
    pushedError: itemAgg
      .filter((a) => a.pushResult?.startsWith("error:"))
      .reduce((acc, a) => acc + a._count, 0),
    pending: itemAgg.find((a) => a.pushResult === null)?._count ?? 0,
  };

  return Response.json({ import: imp, counts });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const imp = await prisma.thingsImport.findFirst({
    where: { id, userId: session.uid },
  });
  if (!imp) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (imp.status === "executing") {
    return Response.json({ error: "Import právě běží — počkej na dokončení." }, { status: 409 });
  }

  await prisma.thingsImport.delete({ where: { id } });
  return Response.json({ ok: true });
};
