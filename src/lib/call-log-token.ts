/**
 * VIP call-log token — privátní URL klíč pro:
 *   - /call-log?t=<token>          (zadávání misí, pre-fill telefonu)
 *   - /call-log/thanks?t=<token>   (potvrzení + výpis Giďoušových misí)
 *
 * Token = 24 znaků base64url (≈ 144 bitů entropie). Stabilní per Contact;
 * regenerace přes /api/contacts/:id/call-log-token/regenerate (zruší předchozí link).
 *
 * Bezpečnostní model: kdo má token, smí vidět seznam misí daného VIP. Phone-based
 * přístup k seznamu je odstraněn — phone smí jen submitnout novou misi (to není
 * citlivé), ale výpis vidí jen držitel tokenu.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "./db";

export function generateCallLogToken(): string {
  // 18 bytes random → 24 znaků base64url bez paddingu
  return randomBytes(18).toString("base64url");
}

/**
 * Pokud kontakt nemá token a je VIP, vygeneruje ho a uloží.
 * Vrátí aktuální token (i pokud už existoval).
 */
export async function ensureCallLogToken(contactId: string): Promise<string | null> {
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, isVip: true, callLogToken: true },
  });
  if (!c || !c.isVip) return null;
  if (c.callLogToken) return c.callLogToken;

  // Generuj token; v krajním případě (kolize) zkusíme znovu — pravděpodobnost
  // < 1 / 2^144, ale lépe být robustní.
  for (let i = 0; i < 5; i++) {
    const token = generateCallLogToken();
    try {
      const updated = await prisma.contact.update({
        where: { id: c.id },
        data: { callLogToken: token, callLogTokenCreatedAt: new Date() },
        select: { callLogToken: true },
      });
      return updated.callLogToken!;
    } catch (e) {
      // Unique violation → další iterace
      void e;
    }
  }
  throw new Error("Nepodařilo se vygenerovat unikátní callLogToken");
}

/** Vždy nový token (regenerace, neplatní starý link). */
export async function regenerateCallLogToken(contactId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const token = generateCallLogToken();
    try {
      const updated = await prisma.contact.update({
        where: { id: contactId },
        data: { callLogToken: token, callLogTokenCreatedAt: new Date() },
        select: { callLogToken: true },
      });
      return updated.callLogToken!;
    } catch (e) {
      void e;
    }
  }
  throw new Error("Nepodařilo se vygenerovat unikátní callLogToken");
}

/**
 * Lookup VIP kontaktu podle tokenu. Vrátí null pokud token neexistuje
 * nebo kontakt není VIP (defense-in-depth — pokud Petr VIP odebere, link přestane fungovat).
 */
export async function resolveCallLogToken(token: string) {
  if (!token || token.length < 16 || token.length > 64) return null;
  const contact = await prisma.contact.findUnique({
    where: { callLogToken: token },
    include: { phones: { take: 1 } },
  });
  if (!contact || !contact.isVip) return null;
  return contact;
}
