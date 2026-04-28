import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { syncBothIcloud, syncIcloud } from "@/lib/icloud-calendar";

export const prerender = false;

/**
 * POST /api/integrations/icloud/sync
 * Body: { what?: "son" | "partner" | "all" }  (default "all")
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const what = body.what ?? "all";

  try {
    if (what === "son") {
      const result = await syncIcloud(session.uid, "ICLOUD_SON");
      return Response.json({ ok: true, son: result });
    }
    if (what === "partner") {
      const result = await syncIcloud(session.uid, "ICLOUD_PARTNER");
      return Response.json({ ok: true, partner: result });
    }
    const result = await syncBothIcloud(session.uid);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};
