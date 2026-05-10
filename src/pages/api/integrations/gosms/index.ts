import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { testCredentials, invalidateTokenCache, type GosmsConfig } from "@/lib/gosms";

export const prerender = false;

const Body = z.object({
  clientId: z.string().min(3).max(200),
  clientSecret: z.string().min(3).max(500),
});

/**
 * POST — uložit / přepsat credentials.
 * Před uložením otestuje credentials proti GoSMS API a načte detail organizace
 * (kredit, kanály) — uloží do config aby UI hned věděla co je k dispozici.
 * Pokud zatím není webhookSecret, vygeneruje ho.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const test = await testCredentials({
    clientId: body.clientId,
    clientSecret: body.clientSecret,
  });
  if (!test.ok) {
    return Response.json({ error: `Credentials nefungují: ${test.error}` }, { status: 400 });
  }

  const { enc, iv, tag } = encryptSecret(body.clientSecret);

  // Pokud existuje, zachovej webhookSecret + defaultChannel; jinak vygeneruj.
  const existing = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "gosms" } },
  });
  const existingConfig = ((existing?.config as unknown) ?? {}) as GosmsConfig;

  const channels = test.organization.channels;
  const config: GosmsConfig = {
    clientId: body.clientId,
    defaultChannel:
      existingConfig.defaultChannel ?? (channels.length > 0 ? channels[0]!.id : undefined),
    webhookSecret: existingConfig.webhookSecret ?? randomBytes(24).toString("base64url"),
    organization: test.organization,
    organizationFetchedAt: new Date().toISOString(),
  };

  await prisma.userIntegration.upsert({
    where: { userId_provider: { userId: session.uid, provider: "gosms" } },
    create: {
      userId: session.uid,
      provider: "gosms",
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: config as unknown as object,
      lastUsedAt: new Date(),
    },
    update: {
      tokenEnc: enc,
      tokenIv: iv,
      tokenTag: tag,
      config: config as unknown as object,
      lastError: null,
      lastUsedAt: new Date(),
    },
  });

  invalidateTokenCache(session.uid);

  return Response.json({
    ok: true,
    organization: test.organization,
    webhookSecret: config.webhookSecret,
  });
};

/**
 * DELETE — odpojit GoSMS (smaže credentials i config).
 * SmsMessage / SmsReply log zůstávají (audit trail).
 */
export const DELETE: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await prisma.userIntegration.deleteMany({
    where: { userId: session.uid, provider: "gosms" },
  });
  invalidateTokenCache(session.uid);

  return Response.json({ ok: true });
};
