import type { APIRoute } from "astro";
import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "@/lib/db";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { issuePreauth } from "@/lib/webauthn";
import { createSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Konstantní-čas placeholder (hash prázdného stringu) — aby neexistující user
// trval stejně dlouho jako existující. Nikdy neprojde jako validní.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$jJ6tTnZSSqXJYU0wIIG6M4P1hY/1p1v1iSiXDQjnNyo";

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const ip = clientIp(request, clientAddress);

  const limit = await checkLoginRateLimit(body.username, ip);
  if (limit) {
    return Response.json({ error: "RATE_LIMITED", scope: limit }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { username: body.username },
    include: { passkeys: { select: { id: true } } },
  });
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH;

  let valid = false;
  try {
    valid = await argon2.verify(hashToCheck, body.password);
  } catch {
    valid = false;
  }

  if (!user || !valid) {
    await recordLoginAttempt(body.username, ip, false);
    return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  // Petr 2026-06-18 (lokální dev): pokud DEV_SKIP_PASSKEY=1 AND běžíme proti
  // localhost (host header), vystavit plnou session rovnou bez passkey kroku.
  //
  // Bezpečnostní pojistky (musí PROJÍT VŠECHNY 3):
  //   1) NODE_ENV !== "production" (nikdy v produkci)
  //   2) process.env.DEV_SKIP_PASSKEY === "1" (explicit opt-in, v .env.local)
  //   3) Host header je localhost / 127.0.0.1 (ne veřejná IP)
  //
  // Stejný hardening jako v src/lib/session.ts:secure=NODE_ENV === "production".
  // Pokud kdokoli z těch tří selže, fallback na původní passkey flow.
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const devBypass =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_SKIP_PASSKEY === "1" &&
    isLocalhost;

  if (devBypass) {
    await createSession(cookies, user.id, ip, request.headers.get("user-agent") ?? undefined);
    await recordLoginAttempt(body.username, ip, true);
    return Response.json({ ok: true, next: "done" });
  }

  // Heslo OK — NESPOUŠTĚJ full session. Vystav preauth cookie a pošli klienta
  // na passkey krok: buď přihlášení stávajícím passkey, nebo enrollment.
  const needsEnrollment = user.passkeys.length === 0;
  await issuePreauth(cookies, user.id, needsEnrollment);

  return Response.json({
    ok: true,
    next: needsEnrollment ? "enroll_passkey" : "verify_passkey",
  });
};
