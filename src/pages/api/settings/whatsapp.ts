import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { sendWhatsApp } from "@/lib/whatsapp";

export const prerender = false;

const SaveBody = z.object({
  accountSid: z.string().min(10).max(100),
  authToken: z.string().min(10).max(200), // optional new token; pokud prázdné, zachovat staré
  fromNumber: z.string().min(8).max(30), // E.164 nebo "whatsapp:+..."
  whatsappNumber: z.string().min(8).max(30), // Petrovo target číslo
});

const TestBody = z.object({
  message: z.string().min(1).max(500).optional(),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const [user, integration] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.uid },
      select: { whatsappNumber: true },
    }),
    prisma.userIntegration.findUnique({
      where: { userId_provider: { userId: session.uid, provider: "twilio" } },
      select: { config: true, lastUsedAt: true, lastError: true },
    }),
  ]);

  const cfg = (integration?.config ?? {}) as { accountSid?: string; fromNumber?: string };

  return Response.json({
    configured: Boolean(integration && cfg.accountSid && cfg.fromNumber),
    accountSid: cfg.accountSid ?? "",
    fromNumber: cfg.fromNumber ?? "",
    whatsappNumber: user?.whatsappNumber ?? "",
    lastUsedAt: integration?.lastUsedAt,
    lastError: integration?.lastError,
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof SaveBody>;
  try {
    body = SaveBody.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  // Šifrování auth tokenu
  const enc = encryptSecret(body.authToken);

  await prisma.userIntegration.upsert({
    where: { userId_provider: { userId: session.uid, provider: "twilio" } },
    update: {
      tokenEnc: enc.enc,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      config: { accountSid: body.accountSid, fromNumber: body.fromNumber },
      lastError: null,
    },
    create: {
      userId: session.uid,
      provider: "twilio",
      tokenEnc: enc.enc,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      config: { accountSid: body.accountSid, fromNumber: body.fromNumber },
    },
  });

  await prisma.user.update({
    where: { id: session.uid },
    data: { whatsappNumber: body.whatsappNumber },
  });

  return Response.json({ ok: true });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  // Test endpoint — pošli testovací zprávu na uživatelovo whatsappNumber
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = TestBody.safeParse(body);

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { whatsappNumber: true },
  });
  if (!user?.whatsappNumber) {
    return Response.json({ error: "Nejdřív ulož cílové WhatsApp číslo." }, { status: 400 });
  }

  const message = (parsed.success && parsed.data.message) ||
    `🕯 Rašeliniště — testovací zpráva.\n\nWhatsApp integrace funguje. Můžeš zavřít.`;

  const result = await sendWhatsApp(session.uid, {
    to: user.whatsappNumber,
    body: message,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, sid: result.sid });
};
