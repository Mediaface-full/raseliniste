import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { syncTodoistForUser } from "@/lib/todoist-sync";

export const prerender = false;

/**
 * GET /api/call-log/by-phone?phone=...&days=14
 *
 * Veřejný endpoint pro VIP — vrátí seznam jejich misí.
 * Identifikace přes phone (stejný princip jako /call-log/thanks).
 *
 * Otevřené (seenAt = null) = pořád vidí.
 * Hotové (seenAt != null) = jen za posledních N dní (default 14).
 *
 * Spustí on-demand Todoist sync pro vlastníka (pokud poslední byl > 5 min)
 * — VIP tak vidí čerstvý stav i mimo 30min cron.
 */
export const GET: APIRoute = async ({ url }) => {
  const phoneRaw = url.searchParams.get("phone")?.trim() ?? "";
  if (!phoneRaw) return Response.json({ error: "MISSING_PHONE" }, { status: 400 });

  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") ?? "14", 10) || 14));

  const normalized = normalizePhone(phoneRaw);
  if (!normalized) return Response.json({ error: "INVALID_PHONE" }, { status: 400 });

  // Najdi VIP kontakt (jen VIP smí vidět svůj výpis)
  const phoneRecord = await prisma.phone.findFirst({
    where: { number: normalized },
    include: { contact: true },
  });
  if (!phoneRecord?.contact || !phoneRecord.contact.isVip) {
    return Response.json({
      open: [],
      done: [],
      isVip: false,
    });
  }

  const userId = phoneRecord.contact.userId;

  // On-demand Todoist sync pokud poslední byl > 5 min
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { todoistSyncedAt: true },
  });
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  if (!user?.todoistSyncedAt || user.todoistSyncedAt.getTime() < fiveMinAgo) {
    // Best-effort, neblokovat odpověď při chybě
    syncTodoistForUser(userId).catch((e) => {
      console.warn("[call-log/by-phone] on-demand sync failed:", e);
    });
  }

  const sinceDone = new Date(Date.now() - days * 86400000);

  const calls = await prisma.callLog.findMany({
    where: {
      userId,
      phoneNumber: normalized,
      wasVip: true,
      OR: [
        { seenAt: null },
        { seenAt: { gte: sinceDone } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      message: true,
      isUrgent: true,
      requestedDueAt: true,
      seenAt: true,
      createdAt: true,
      todoistTaskId: true,
    },
  });

  const open = calls.filter((c) => c.seenAt === null);
  const done = calls.filter((c) => c.seenAt !== null);

  return Response.json({
    isVip: true,
    contactName: phoneRecord.contact.firstName ?? phoneRecord.contact.displayName,
    open,
    done,
    daysWindow: days,
  });
};
