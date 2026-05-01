/**
 * Web Push notifikace (Apple/Google/Mozilla push servisy přes VAPID).
 *
 * Setup:
 *   1. Jednorázově: `npx web-push generate-vapid-keys` → 2 klíče
 *   2. .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
 *   3. Klient (browser): registruje SW, navigator.pushManager.subscribe(),
 *      pošle PushSubscription na /api/push/subscribe
 *   4. Server: ulož do WebPushSubscription tabulky
 *   5. Send: webpush.sendNotification(subscription, JSON.stringify(payload))
 *
 * iOS specifika:
 *   - Funguje JEN pokud je stránka přidaná na plochu jako PWA (Sdílet → Přidat)
 *   - V prohlížeči Safari (bez PWA) push NEFUNGUJE
 *   - Vyžaduje iOS 16.4+
 *
 * Android: funguje v jakémkoli Chrome (s nebo bez PWA).
 * Desktop: Chrome/Firefox/Edge funguje.
 */

import webpush from "web-push";
import { prisma } from "./db";
import { env } from "./env";

let initialized = false;

function ensureInit(): boolean {
  if (initialized) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn("[webpush] VAPID klíče nejsou v env — push notifikace nefungují");
    return false;
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT ?? "mailto:gideon@raseliniste.cz",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  initialized = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;        // klik na notifikaci → otevře tuto URL
  tag?: string;        // dedup notifikací (stejný tag = nahradí starou)
  icon?: string;       // /apple-touch-icon.png (default)
  badge?: string;      // monochromatický overlay icon (Android)
}

export interface SendResult {
  ok: boolean;
  sent: number;
  failed: number;
  goneCount: number; // 410 = subscription expirovala, smazali jsme
  errors: string[];
}

/**
 * Pošle push notifikaci na všechny aktivní subscriptions daného uživatele.
 * Pokud Apple/Google vrátí 410 (Gone), subscription smaže.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { ok: false, sent: 0, failed: 0, goneCount: 0, errors: [] };

  if (!ensureInit()) {
    result.errors.push("VAPID keys missing");
    return result;
  }

  const subs = await prisma.webPushSubscription.findMany({
    where: { userId },
  });

  if (subs.length === 0) {
    result.errors.push("Žádné push subscriptions pro tohoto uživatele.");
    return result;
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag,
    icon: payload.icon ?? "/apple-touch-icon.png",
    badge: payload.badge ?? "/apple-touch-icon.png",
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      result.sent++;
      await prisma.webPushSubscription.update({
        where: { id: sub.id },
        data: { lastUsedAt: new Date(), lastError: null },
      }).catch(() => null);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (e as any)?.statusCode;
      const msg = e instanceof Error ? e.message : String(e);
      if (status === 410 || status === 404) {
        // Subscription expirovala / zařízení je pryč → smaž
        await prisma.webPushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
        result.goneCount++;
      } else {
        result.failed++;
        result.errors.push(`${sub.label ?? sub.endpoint.slice(-20)}: ${msg.slice(0, 100)}`);
        await prisma.webPushSubscription.update({
          where: { id: sub.id },
          data: { lastError: msg.slice(0, 500) },
        }).catch(() => null);
      }
    }
  }

  result.ok = result.sent > 0;
  return result;
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}
