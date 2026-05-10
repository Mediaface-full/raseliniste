import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { loadGosmsCredentials, type GosmsConfig } from "@/lib/gosms";

export const prerender = false;

/**
 * POST — vygeneruje nový webhookSecret. Stará URL přestane platit, Petr musí
 * v GoSMS samoobsluze nastavit novou.
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const loaded = await loadGosmsCredentials(session.uid);
  if (!loaded) {
    return Response.json({ error: "GoSMS není nakonfigurováno." }, { status: 400 });
  }

  const newSecret = randomBytes(24).toString("base64url");
  const config: GosmsConfig = { ...loaded.config, webhookSecret: newSecret };

  await prisma.userIntegration.update({
    where: { userId_provider: { userId: session.uid, provider: "gosms" } },
    data: { config: config as unknown as object },
  });

  return Response.json({ ok: true, webhookSecret: newSecret });
};
