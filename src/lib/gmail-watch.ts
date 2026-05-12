/**
 * Gmail watch helpers — start/stop/refresh push notifications.
 *
 * Setup: `docs/email-intelligence/INFRASTRUCTURE.md` popisuje jednorázové
 * GCP Pub/Sub kroky. Tento lib pak volá Gmail API `users.watch()` +
 * `users.stop()` per uživatel.
 *
 * Watch lifetime: max 7 dnů (Gmail limit). Cron `posta-watch-renew` každých
 * 5 dnů (bezpečná rezerva) zavolá `startWatch` znovu — Gmail vrátí nové
 * `historyId` + `expiration`.
 */

import { google } from "googleapis";
import { getAuthorizedClient, recordError, recordUsage } from "./google-oauth";
import { env } from "./env";
import { prisma } from "./db";

const GMAIL_USER_ID = "me";

export interface StartWatchResult {
  historyId: string;
  expirationMs: number; // epoch ms
}

/**
 * Spustí push notifications pro uživatelův inbox.
 * Vrací { historyId, expirationMs } z Gmail.
 *
 * Volá Gmail `users.watch()` s naším Pub/Sub topic.
 * Watch je per `topicName` — voláním znovu se obnoví expiration.
 */
export async function startWatch(userId: string): Promise<StartWatchResult> {
  const topic = env.GMAIL_PUBSUB_TOPIC;
  if (!topic) {
    throw new Error(
      "GMAIL_PUBSUB_TOPIC není nakonfigurovaný. Doplň do .env full topic name " +
        '"projects/<gcp-project>/topics/<topic>" a viz docs/email-intelligence/INFRASTRUCTURE.md.',
    );
  }

  try {
    const auth = await getAuthorizedClient(userId);
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.watch({
      userId: GMAIL_USER_ID,
      requestBody: {
        topicName: topic,
        labelIds: ["INBOX"], // jen INBOX (ne spam/trash)
        labelFilterBehavior: "INCLUDE",
      },
    });
    await recordUsage(userId);

    const historyId = String(res.data.historyId ?? "");
    const expirationMs = Number(res.data.expiration ?? 0);

    await prisma.user.update({
      where: { id: userId },
      data: {
        gmailHistoryId: historyId,
        gmailWatchExpiresAt: expirationMs > 0 ? new Date(expirationMs) : null,
        gmailWatchTopicName: topic,
      },
    });

    console.log(
      `[gmail-watch] start userId=${userId} historyId=${historyId} expires=${new Date(expirationMs).toISOString()}`,
    );
    return { historyId, expirationMs };
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Zastaví push notifications.
 */
export async function stopWatch(userId: string): Promise<void> {
  try {
    const auth = await getAuthorizedClient(userId);
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.stop({ userId: GMAIL_USER_ID });
    await recordUsage(userId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        gmailWatchExpiresAt: null,
        gmailWatchTopicName: null,
      },
    });

    console.log(`[gmail-watch] stop userId=${userId}`);
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}

/**
 * Spustí incremental sync přes `users.history.list` od poslední známé `gmailHistoryId`.
 * Volá se z webhook handleru po obdržení push notifikace.
 *
 * Vrátí počet importovaných mailů + nové historyId.
 */
export async function processHistoryFromPush(userId: string): Promise<{
  imported: number;
  newHistoryId: string;
  errors: string[];
}> {
  const errors: string[] = [];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailHistoryId: true },
  });
  if (!user?.gmailHistoryId) {
    // Bez historyId nemůžeme dělat incremental — fallback na full sync přes posta-sync.ts
    // (Petr by neměl tento case potkat — startWatch vždy uloží historyId.)
    return { imported: 0, newHistoryId: "", errors: ["NO_HISTORY_ID"] };
  }

  try {
    const auth = await getAuthorizedClient(userId);
    const gmail = google.gmail({ version: "v1", auth });

    // history.list vrací změny od daného historyId. Po novém mailu obvykle
    // 1-3 history records (added/changed), každý s 1 message ID.
    const res = await gmail.users.history.list({
      userId: GMAIL_USER_ID,
      startHistoryId: user.gmailHistoryId,
      historyTypes: ["messageAdded"],
    });
    await recordUsage(userId);

    const histories = res.data.history ?? [];
    const newMessageIds = new Set<string>();
    for (const h of histories) {
      for (const ma of h.messagesAdded ?? []) {
        if (ma.message?.id) newMessageIds.add(ma.message.id);
      }
    }

    if (newMessageIds.size === 0) {
      // Push notification přišla, ale history vrací prázdno — Gmail občas
      // pushne i pro changed labels (ne nový mail). OK, jen aktualizujeme historyId.
      const newHistoryId = String(res.data.historyId ?? user.gmailHistoryId);
      await prisma.user.update({
        where: { id: userId },
        data: { gmailHistoryId: newHistoryId, gmailLastPushAt: new Date() },
      });
      return { imported: 0, newHistoryId, errors };
    }

    // Re-use existující fetch + classify pipeline z posta-sync.ts.
    // Mírně duplicate kód, ale zachová decoupling — push handler nemusí volat
    // celý syncPostaForUser (full pull + getProfile).
    const { getMessage, parseGmailMessage } = await import("./gmail");
    const { encryptBody, isEncryptionEnabled } = await import("./email-body-crypto");

    let imported = 0;
    const encEnabled = isEncryptionEnabled();
    for (const msgId of newMessageIds) {
      try {
        const raw = await getMessage(userId, msgId);
        const parsed = parseGmailMessage(raw);

        const textPacket = encEnabled ? encryptBody(parsed.bodyText) : null;
        const htmlPacket = encEnabled ? encryptBody(parsed.bodyHtml) : null;

        await prisma.emailMessage.upsert({
          where: { gmailMessageId: parsed.gmailMessageId },
          create: {
            userId,
            gmailMessageId: parsed.gmailMessageId,
            threadId: parsed.threadId,
            fromAddress: parsed.fromAddress,
            fromName: parsed.fromName,
            toAddresses: parsed.toAddresses,
            ccAddresses: parsed.ccAddresses,
            bccAddresses: parsed.bccAddresses,
            subject: parsed.subject,
            snippet: parsed.snippet,
            bodyText: encEnabled ? null : parsed.bodyText,
            bodyHtml: encEnabled ? null : parsed.bodyHtml,
            bodyTextCiphertext: textPacket?.ciphertext ?? null,
            bodyHtmlCiphertext: htmlPacket?.ciphertext ?? null,
            bodyEncryptionKeyId: encEnabled ? (textPacket?.keyId ?? htmlPacket?.keyId ?? null) : null,
            labels: parsed.labels,
            hasAttachments: parsed.hasAttachments,
            attachments: parsed.attachments.length > 0 ? (parsed.attachments as unknown as object) : undefined,
            rawHeaders: parsed.rawHeaders as unknown as object,
            receivedAt: parsed.receivedAt,
          },
          update: { labels: parsed.labels },
        });
        imported++;
      } catch (e) {
        errors.push(`${msgId}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }

    const newHistoryId = String(res.data.historyId ?? user.gmailHistoryId);
    await prisma.user.update({
      where: { id: userId },
      data: { gmailHistoryId: newHistoryId, gmailLastPushAt: new Date() },
    });

    console.log(
      `[gmail-push] userId=${userId} imported=${imported} errors=${errors.length} newHistoryId=${newHistoryId}`,
    );
    return { imported, newHistoryId, errors };
  } catch (err) {
    await recordError(userId, err);
    throw err;
  }
}
