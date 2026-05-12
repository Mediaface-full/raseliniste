/**
 * EmailBodyCrypto — AES-256-GCM wrapper pro EmailMessage.bodyText/bodyHtml.
 *
 * **OD SESSION_SECRET ODDĚLENO** per Petrovo zadání fáze 5 — vlastní klíč
 * `EMAIL_BODY_ENCRYPTION_KEY` (32 bytes hex). Důvod: kompromitace
 * SESSION_SECRET = útok na session cookies, ale ne automaticky na email body.
 *
 * Formát ciphertextu v DB: base64( nonce(12B) || ciphertext(N) || tag(16B) )
 * Single column místo 3 kvůli snadnému Prisma I/O.
 *
 * keyId v DB → "env:current" označuje aktuální ENV klíč. Při rotaci přidáme
 * nový keyId "env:v2" + EncryptionKey row, stará data zůstávají dešifrovatelná
 * dokud držíme oba klíče (production runtime by načítal i `..._v1`).
 *
 * Pro fázi 5 implementujeme JEN current key. Rotace = future work.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { env } from "./env";

const KEY_ID_CURRENT = "env:current";
const NONCE_BYTES = 12; // standard pro GCM
const TAG_BYTES = 16;

interface EncryptedPacket {
  keyId: string;
  ciphertext: string; // base64 — nonce || ciphertext || tag packed
}

interface ResolvedKey {
  keyId: string;
  keyBuffer: Buffer;
}

// In-memory cache (klíč se nemění během runtime; ENV reload by vyžadoval restart)
let cachedKey: ResolvedKey | null = null;

/**
 * Vrátí aktuální klíč. Throws pokud EMAIL_BODY_ENCRYPTION_KEY není
 * nakonfigurován NEBO je nevalidní (ne 64 hex chars).
 */
function getCurrentKey(): ResolvedKey {
  if (cachedKey) return cachedKey;

  const raw = env.EMAIL_BODY_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_BODY_ENCRYPTION_KEY není nakonfigurovaný. Pro fázi 5 nastav v .env: " +
        "EMAIL_BODY_ENCRYPTION_KEY=<64 hex chars> (vygeneruj `openssl rand -hex 32`).",
    );
  }
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error(
      "EMAIL_BODY_ENCRYPTION_KEY musí být 64 hex znaků (32 bytes). Vygeneruj `openssl rand -hex 32`.",
    );
  }
  const keyBuffer = Buffer.from(raw, "hex");
  cachedKey = { keyId: KEY_ID_CURRENT, keyBuffer };
  return cachedKey;
}

/**
 * Zkontroluje že EncryptionKey row pro aktuální keyId existuje v DB, vytvoří
 * pokud chybí (s placeholder SHA-256 hashem klíče pro detekci nesouladu).
 * Voláme z aplikačního startupu nebo při prvním šifrování.
 */
export async function ensureEncryptionKeyRegistered(): Promise<void> {
  const key = getCurrentKey();
  const hash = createHash("sha256").update(key.keyBuffer).digest("hex");

  const existing = await prisma.encryptionKey.findUnique({
    where: { keyId: key.keyId },
  });

  if (!existing) {
    await prisma.encryptionKey.create({
      data: {
        keyId: key.keyId,
        keyHashSha256: hash,
        note: "auto-registered on first use",
      },
    });
    console.log(`[crypto] EncryptionKey registered: ${key.keyId} hash=${hash.slice(0, 16)}...`);
    return;
  }

  if (existing.keyHashSha256 !== hash) {
    throw new Error(
      `EMAIL_BODY_ENCRYPTION_KEY hash mismatch — DB má registrovaný jiný klíč pro keyId=${key.keyId}. ` +
        `Buď jsi přepsal klíč v .env (musíš rotovat přes novou keyId), nebo DB obsahuje data šifrovaná jiným klíčem. ` +
        `DB hash: ${existing.keyHashSha256.slice(0, 16)}..., ENV hash: ${hash.slice(0, 16)}...`,
    );
  }
}

/**
 * Zašifruj plaintext. Vrátí packet { keyId, ciphertext } pro uložení do DB.
 *
 * `null`/empty input vrátí `null` (znamená "není body co šifrovat").
 */
export function encryptBody(plaintext: string | null | undefined): EncryptedPacket | null {
  if (!plaintext) return null;

  const key = getCurrentKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.keyBuffer, nonce);
  const ciphertextBuf = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([nonce, ciphertextBuf, tag]).toString("base64");
  return { keyId: key.keyId, ciphertext: packed };
}

/**
 * Dešifruj packet zpět na plaintext. Throws pokud:
 *  - keyId neznámý (klíč není v env / runtime)
 *  - tag mismatch (data byla manipulována)
 *  - ciphertext malformed
 */
export function decryptBody(packet: { keyId: string; ciphertext: string } | null): string | null {
  if (!packet) return null;

  // Faze 5: podporujeme jen current key. Rotace = future work, pak rozšířit.
  if (packet.keyId !== KEY_ID_CURRENT) {
    throw new Error(
      `decryptBody: unknown keyId=${packet.keyId}. Aktualní runtime klíč je ${KEY_ID_CURRENT}. ` +
        `Pokud byla rotace, doplň podporu pro stary klic do email-body-crypto.ts.`,
    );
  }

  const key = getCurrentKey();
  const buf = Buffer.from(packet.ciphertext, "base64");
  if (buf.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error(`decryptBody: ciphertext příliš krátký (${buf.length} B)`);
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key.keyBuffer, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Helper pro práci s EmailMessage row — vrátí plaintext bodyText.
 * Preference:
 *   1. bodyTextCiphertext + bodyEncryptionKeyId → decrypt
 *   2. bodyText (legacy plain) → vrátit přímo
 *   3. null
 *
 * NEVOLAT v render path bez potřeby — decrypt je drahý relativně k DB read.
 * Cachovat plaintext v request scope pokud potřebuješ víckrát.
 */
export function getDecryptedBodyText(email: {
  bodyText: string | null;
  bodyTextCiphertext: string | null;
  bodyEncryptionKeyId: string | null;
}): string | null {
  if (email.bodyTextCiphertext && email.bodyEncryptionKeyId) {
    return decryptBody({ keyId: email.bodyEncryptionKeyId, ciphertext: email.bodyTextCiphertext });
  }
  return email.bodyText;
}

export function getDecryptedBodyHtml(email: {
  bodyHtml: string | null;
  bodyHtmlCiphertext: string | null;
  bodyEncryptionKeyId: string | null;
}): string | null {
  if (email.bodyHtmlCiphertext && email.bodyEncryptionKeyId) {
    return decryptBody({ keyId: email.bodyEncryptionKeyId, ciphertext: email.bodyHtmlCiphertext });
  }
  return email.bodyHtml;
}

/**
 * Pro testy / debug — vrátí jestli je encryption aktivní (klíč nakonfigurovaný).
 */
export function isEncryptionEnabled(): boolean {
  try {
    getCurrentKey();
    return true;
  } catch {
    return false;
  }
}
