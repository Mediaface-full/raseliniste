/**
 * Načtení VIP misí (CallLog) pro výpis na /call-log a /call-log/thanks.
 *
 * Match: contactId NEBO phoneNumber IN (všechna čísla VIP) — VIP může mít
 * víc telefonů a zadat misi z různých.
 *
 * Zdrojem pravdy stavu (seenAt) je cron /api/cron/todoist-sync (30 min).
 */

import { prisma } from "./db";

export interface VipMission {
  id: string;
  message: string;
  isUrgent: boolean;
  requestedDueAt: Date | null;
  seenAt: Date | null;
  createdAt: Date;
}

export interface VipMissionsResult {
  open: VipMission[];
  done: VipMission[];
}

export const VIP_MISSIONS_DONE_DAYS = 14;

export async function loadVipMissions(params: {
  userId: string;
  contactId: string;
  phones: string[];
  days?: number;
}): Promise<VipMissionsResult> {
  const days = params.days ?? VIP_MISSIONS_DONE_DAYS;
  const sinceDone = new Date(Date.now() - days * 86400000);

  const calls = await prisma.callLog.findMany({
    where: {
      userId: params.userId,
      wasVip: true,
      OR: [{ seenAt: null }, { seenAt: { gte: sinceDone } }],
      AND: {
        OR: [
          { contactId: params.contactId },
          ...(params.phones.length > 0 ? [{ phoneNumber: { in: params.phones } }] : []),
        ],
      },
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

  return {
    open: calls.filter((c) => c.seenAt === null),
    done: calls.filter((c) => c.seenAt !== null),
  };
}

export function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "před chvílí";
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return "včera";
  if (days < 7) return `před ${days} dny`;
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

export function formatDue(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}
