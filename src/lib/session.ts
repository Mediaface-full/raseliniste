import { SignJWT, jwtVerify } from "jose";
import type { AstroCookies } from "astro";
import { prisma } from "./db";
import { env } from "./env";

export const SESSION_COOKIE = "rs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dní

let cachedSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!cachedSecret) cachedSecret = new TextEncoder().encode(env.SESSION_SECRET);
  return cachedSecret;
}

export type SessionPayload = { sid: string; uid: string };

export async function createSession(
  cookies: AstroCookies,
  userId: string,
  ip?: string,
  ua?: string
) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const row = await prisma.session.create({
    data: { userId, expiresAt, ip, userAgent: ua },
  });

  const token = await new SignJWT({ sid: row.id, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());

  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return row;
}

export async function readSession(cookies: AstroCookies): Promise<SessionPayload | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sid = payload.sid as string;
    const uid = payload.uid as string;
    const row = await prisma.session.findUnique({ where: { id: sid } });
    if (!row || row.expiresAt < new Date()) return null;
    return { sid, uid };
  } catch {
    return null;
  }
}

export async function destroySession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      await prisma.session
        .delete({ where: { id: payload.sid as string } })
        .catch(() => null);
    } catch {
      // ignore — invalid/expired token
    }
  }
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
