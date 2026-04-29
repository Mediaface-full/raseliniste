import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { getUsageStats } from "@/lib/gemini-usage";

export const prerender = false;

/**
 * GET /api/settings/ai-usage?period=today|7d|30d|month|all
 *
 * Vrátí agregovanou statistiku Gemini volání pro dashboardu.
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const period = url.searchParams.get("period") ?? "30d";
  const now = new Date();
  let fromDate: Date;
  const toDate = now;

  switch (period) {
    case "today":
      fromDate = new Date(now);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case "7d":
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "all":
      fromDate = new Date(2020, 0, 1);
      break;
    case "30d":
    default:
      fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  const stats = await getUsageStats({ fromDate, toDate });
  return Response.json(stats);
};
