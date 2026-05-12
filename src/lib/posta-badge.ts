/**
 * Sidebar badge counter pro /posta.
 *
 * Pocita pocet "vyzaduje akci dnes" mailu:
 *   - actionType = "action_required"
 *   - (urgency = "high" OR escalation = true)
 *   - resolvedAt IS NULL
 *
 * Pouziva se v Shell.astro pro zobrazeni cisla u polozky Posta.
 *
 * Cache 60s in-memory per userId — pri single-user instance staci.
 * Pri vetsim trafficu nahradit Redisem nebo edge cache.
 */

import { prisma } from "./db";

interface CacheEntry {
  count: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function getPostaBadgeCount(userId: string): Promise<number> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.count;
  }

  const count = await prisma.emailMessage.count({
    where: {
      userId,
      resolvedAt: null,
      classification: {
        actionType: "action_required",
        OR: [{ urgency: "high" }, { escalation: true }],
      },
    },
  });

  cache.set(userId, { count, expiresAt: now + CACHE_TTL_MS });
  return count;
}

/**
 * Invalidace cache (vola se z resolve / unresolve endpointu + po cron sync).
 * Petr po akci v UI uvidi badge update pri pristim navsteve stranky.
 */
export function invalidatePostaBadgeCache(userId: string): void {
  cache.delete(userId);
}
