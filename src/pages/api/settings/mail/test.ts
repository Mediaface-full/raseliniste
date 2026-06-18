import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

export const prerender = false;

const Body = z.object({
  to: z.string().email().max(200),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "Neplatný email." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { username: true, notificationEmail: true },
  });

  const to = body.to || user?.notificationEmail || env.NOTIFICATION_EMAIL;
  if (!to) return Response.json({ error: "Není kam poslat test." }, { status: 400 });

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1714;color:#e8e3d9;margin:0;padding:20px;">
<div style="max-width:480px;margin:0 auto;background:#241f1b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
  <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b8763c;font-family:ui-monospace,monospace;margin-bottom:6px;">
    Rašeliniště · Test
  </div>
  <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;color:#fff;">Testovací e-mail</h1>
  <p style="font-size:14px;line-height:1.5;">
    Pokud tohle vidíš, SMTP funguje správně. 
  </p>
  <div style="margin-top:16px;font-size:11px;color:#6b665f;font-family:ui-monospace,monospace;">
    Odesláno ${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
  </div>
</div>
</body></html>`;

  const result = await sendMail({
    to,
    subject: "Rašeliniště · test SMTP",
    html,
    text: "Testovací e-mail z Rašeliniště. SMTP funguje.",
  });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, provider: result.provider, id: result.id });
};
