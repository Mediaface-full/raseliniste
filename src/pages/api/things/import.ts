import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { CuratedFile, summarize } from "@/lib/things-import";

export const prerender = false;

/**
 * POST /api/things/import
 *
 * Multipart upload curated JSON, NEBO application/json POST přímo s tělem.
 *  - Validace přes zod
 *  - Vytvoří ThingsImport + ThingsImportItem záznamy
 *  - Vrátí importId + counts; status="uploaded" (execute spustíš zvlášť)
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let raw: unknown;
  let filename = "things-curated.json";
  const ct = request.headers.get("content-type") ?? "";

  try {
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "Soubor chybí." }, { status: 400 });
      }
      filename = file.name || filename;
      const text = await file.text();
      raw = JSON.parse(text);
    } else {
      raw = await request.json();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Nelze přečíst JSON: ${msg}` }, { status: 400 });
  }

  const parsed = CuratedFile.safeParse(raw);
  if (!parsed.success) {
    return Response.json({
      error: "Validace selhala",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }, { status: 400 });
  }

  const data = parsed.data;
  const counts = summarize(data.items);

  const imp = await prisma.thingsImport.create({
    data: {
      userId: session.uid,
      filename,
      rawJson: data as unknown as object,
      totalCount: counts.total,
      migrateCount: counts.migrate,
      wishlistCount: counts.wishlist,
      discardCount: counts.discard,
      status: "uploaded",
      items: {
        create: data.items.map((it) => ({
          thingsUuid: it.thingsUuid,
          title: it.title,
          decision: it.decision,
        })),
      },
    },
  });

  return Response.json({
    import: {
      id: imp.id,
      status: imp.status,
      filename: imp.filename,
      counts,
      createdAt: imp.createdAt,
    },
  });
};

/**
 * GET /api/things/import — historie všech importů aktuálního usera
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const imports = await prisma.thingsImport.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      status: true,
      totalCount: true,
      migrateCount: true,
      wishlistCount: true,
      discardCount: true,
      createdAt: true,
      completedAt: true,
    },
    take: 100,
  });

  return Response.json({ imports });
};
