import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendPushToUser } from "@/lib/webpush";

export const prerender = false;

/**
 * Nedělní připomínka weekly review (ADHD F2, Petr 2026-07-22).
 * Dispatcher volá denně v 18:00; endpoint sám no-opne mimo neděli
 * (schedule typ "weekly" v dispatcheru není — nejjednodušší je guard tady).
 *
 * Curl: curl -X POST ".../api/cron/weekly-review" -H "x-cron-key: <CRON_SECRET>"
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const day = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Prague" });
  if (day !== "Sun") return Response.json({ ok: true, skipped: "not-sunday" });

  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) return Response.json({ ok: true, skipped: "no-user" });

  const openUnplanned = await prisma.task.count({
    where: { userId: user.id, status: "open", plannedFor: null },
  });

  const result = await sendPushToUser(user.id, {
    title: "Nedělní plánování týdne",
    body: openUnplanned > 0
      ? `V backlogu čeká ${openUnplanned} úkolů. 30 minut teď = celý týden pod kontrolou.`
      : "Backlog je čistý — mrkni na rozložení týdne a naplánuj bloky.",
    url: "/planovani",
    tag: "weekly-review",
  });

  return Response.json({ ok: true, push: result });
};
