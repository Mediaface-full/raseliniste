import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { startWatch, stopWatch } from "@/lib/gmail-watch";

export const prerender = false;

const Body = z.object({
  action: z.enum(["start", "stop"]),
});

/**
 * POST /api/integrations/google/posta-watch
 * body: { action: "start" | "stop" }
 *
 * Manuální spuštění / zastavení Gmail watch (push notifications).
 * Default: po prvním nastavení Pub/Sub topic v GCP Petr klikne "Spustit
 * push" v UI → posta-watch action=start → Gmail begin pushing.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "INVALID_INPUT", detail: err instanceof Error ? err.message : "" },
      { status: 400 },
    );
  }

  try {
    if (body.action === "start") {
      const r = await startWatch(session.uid);
      return Response.json({
        ok: true,
        action: "start",
        historyId: r.historyId,
        expiresAt: new Date(r.expirationMs).toISOString(),
      });
    } else {
      await stopWatch(session.uid);
      return Response.json({ ok: true, action: "stop" });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
};
