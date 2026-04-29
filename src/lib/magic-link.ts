import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * HMAC-SHA256 podpisy pro magic-link confirmation tokenů (booking).
 *
 * Token formát: <base64url(payload)>.<base64url(hmac)>
 * Payload JSON: { inviteId: string, expiresAt: epochMs, nonce: string }
 *
 * Klíč: BOOKING_MAGIC_LINK_SECRET z env (fallback na SESSION_SECRET pokud
 * není nastavený, ať to funguje out-of-the-box pro dev).
 */

function getSecret(): string {
  return env.BOOKING_MAGIC_LINK_SECRET || env.SESSION_SECRET;
}

function getTtlHours(): number {
  return env.BOOKING_MAGIC_LINK_TTL_HOURS ?? 24;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

interface Payload {
  inviteId: string;
  expiresAt: number; // epoch ms
  nonce: string;
}

/**
 * Vyrobí magic-link token pro daný invite. TTL z env.
 */
export function signMagicLink(inviteId: string): string {
  const ttlMs = getTtlHours() * 60 * 60 * 1000;
  const payload: Payload = {
    inviteId,
    expiresAt: Date.now() + ttlMs,
    nonce: b64urlEncode(Buffer.from(crypto.getRandomValues(new Uint8Array(8)))),
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Ověří token a vrátí inviteId, nebo null pokud je neplatný / expirovaný.
 */
export function verifyMagicLink(token: string): { inviteId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  const expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.inviteId || typeof payload.expiresAt !== "number") return null;
  if (Date.now() > payload.expiresAt) return null;

  return { inviteId: payload.inviteId };
}
