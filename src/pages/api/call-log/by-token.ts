import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { resolveCallLogToken } from "@/lib/call-log-token";
import { syncTodoistForUser } from "@/lib/todoist-sync";

export const prerender = false;

/**
 * GET /api/call-log/by-token?t=<token>&days=14
 *
 * Veřejný endpoint pro VIP — vrátí seznam jeho misí.
 * Identifikace POUZE přes privátní token (ne phone). Token je generovaný
 * v /contacts (po označení VIP); pokud Petr VIP odebere, link přestane fungovat.
 *
 * Otevřené (seenAt = null) = pořád vidí.
 * Hotové (seenAt != null) = jen za posledních N dní (default 14).
 *
 * On-demand Todoist sync pokud >5 min od posledního — výpis je tak svěží
 * i mimo 30min cron.
 */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("t")?.trim() ?? "";
  if (!token) return Response.json({ error: "MISSING_TOKEN" }, { status: 400 });

  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") ?? "14", 10) || 14));

  const contact = await resolveCallLogToken(token);
  if (!contact) return Response.json({ error: "INVALID_TOKEN" }, { status: 404 });

  const userId = contact.userId;
  const phoneNumber = contact.phones[0]?.number;
  if (!phoneNumber) {
    return Response.json({
      isVip: true,
      contactName: contact.firstName ?? contact.displayName,
      open: [],
      done: [],
      daysWindow: days,
      note: "Kontakt nemá uložený telefon.",
    });
  }

  // On-demand sync (best-effort, neblokovat odpověď)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { todoistSyncedAt: true },
  });
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  if (!user?.todoistSyncedAt || user.todoistSyncedAt.getTime() < fiveMinAgo) {
    syncTodoistForUser(userId).catch((e) => {
      console.warn("[call-log/by-token] on-demand sync failed:", e);
    });
  }

  const sinceDone = new Date(Date.now() - days * 86400000);

  const calls = await prisma.callLog.findMany({
    where: {
      userId,
      phoneNumber,
      wasVip: true,
      OR: [{ seenAt: null }, { seenAt: { gte: sinceDone } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      message: true,
      isUrgent: true,
      requestedDueAt: true,
      seenAt: true,
      createdAt: true,
    },
  });

  return Response.json({
    isVip: true,
    contactName: contact.firstName ?? contact.displayName,
    open: calls.filter((c) => c.seenAt === null),
    done: calls.filter((c) => c.seenAt !== null),
    daysWindow: days,
  });
};
