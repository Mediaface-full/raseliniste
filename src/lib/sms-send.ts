/**
 * Interní helper pro odeslání SMS napříč Rašeliništěm.
 * Volání z task remindů, briefů, birthday cronu atd.
 *
 * Pattern:
 *   import { sendUserSms } from "@/lib/sms-send";
 *   await sendUserSms(userId, {
 *     to: "+420777123456",
 *     message: "Připomínka úkolu...",
 *     linkedEntity: { type: "task", id: task.id },
 *   });
 *
 * Funkce:
 * - načte credentials z UserIntegration
 * - normalizuje čísla
 * - vytvoří SmsMessage row v DB (status=pending)
 * - zavolá GoSMS API
 * - update SmsMessage na sent + gosmsMessageId
 * - při chybě zaznamená do errorMessage + status=failed
 *
 * Vrací { ok: true, smsMessage } nebo { ok: false, error }.
 */

import { prisma } from "./db";
import { loadGosmsCredentials, sendSms, type GosmsConfig } from "./gosms";
import { normalizePhone } from "./phone";

export interface LinkedEntity {
  type: "task" | "contact" | "recording" | "birthday" | "booking" | "ad-hoc";
  id?: string;
  label?: string;
}

export interface SendUserSmsInput {
  to: string | string[];
  message: string;
  channel?: number;
  scheduledFor?: Date | string;
  linkedEntity?: LinkedEntity;
  /** Označit jako pinned — nesmaže ho 90denní cleanup. */
  pinned?: boolean;
}

export type SendUserSmsResult =
  | {
      ok: true;
      smsMessageId: string;
      gosmsMessageId: string;
      invalidRecipients: string[];
    }
  | { ok: false; error: string; smsMessageId?: string };

export async function sendUserSms(
  userId: string,
  input: SendUserSmsInput,
): Promise<SendUserSmsResult> {
  const loaded = await loadGosmsCredentials(userId);
  if (!loaded) {
    return { ok: false, error: "GoSMS není nakonfigurováno." };
  }
  const { creds, config } = loaded;

  const channelId = input.channel ?? config.defaultChannel;
  if (!channelId) {
    return { ok: false, error: "Není nastaven žádný GoSMS kanál (default ani per-call)." };
  }

  // Normalizace čísel pro DB log (i pro samotný API call)
  const rawList = Array.isArray(input.to) ? input.to : [input.to];
  const normalized: string[] = [];
  for (const r of rawList) {
    const n = normalizePhone(r);
    if (!n) {
      return { ok: false, error: `Neplatné telefonní číslo: "${r}"` };
    }
    normalized.push(n);
  }

  const scheduledForDate =
    input.scheduledFor instanceof Date
      ? input.scheduledFor
      : input.scheduledFor
        ? new Date(input.scheduledFor)
        : null;

  // Předem vytvoříme DB row aby měla audit trail i v případě že API selže.
  const sms = await prisma.smsMessage.create({
    data: {
      userId,
      recipients: normalized,
      body: input.message,
      channelId,
      status: "pending",
      scheduledFor: scheduledForDate ?? undefined,
      linkedEntity: (input.linkedEntity as unknown as object | undefined) ?? undefined,
      isPinned: input.pinned ?? false,
      currency: config.organization?.currency ?? null,
    },
  });

  try {
    const result = await sendSms(userId, creds, config, {
      to: normalized,
      message: input.message,
      channel: channelId,
      scheduledFor: scheduledForDate ? scheduledForDate.toISOString() : undefined,
    });

    await prisma.smsMessage.update({
      where: { id: sms.id },
      data: {
        gosmsMessageId: result.gosmsMessageId || null,
        invalidRecipients: result.invalidRecipients,
        status: scheduledForDate && scheduledForDate > new Date() ? "pending" : "sent",
        sentAt: new Date(),
      },
    });

    await prisma.userIntegration.update({
      where: { userId_provider: { userId, provider: "gosms" } },
      data: { lastUsedAt: new Date(), lastError: null },
    });

    return {
      ok: true,
      smsMessageId: sms.id,
      gosmsMessageId: result.gosmsMessageId,
      invalidRecipients: result.invalidRecipients,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.smsMessage.update({
      where: { id: sms.id },
      data: {
        status: "failed",
        failedAt: new Date(),
        errorMessage: msg,
      },
    });
    await prisma.userIntegration.update({
      where: { userId_provider: { userId, provider: "gosms" } },
      data: { lastError: msg },
    });
    return { ok: false, error: msg, smsMessageId: sms.id };
  }
}

/** Re-export pro testy a debug stránky. */
export type { GosmsConfig };
