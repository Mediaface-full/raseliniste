import { env } from "./env";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";

/**
 * Mailer s několika dopravními cestami, v pořadí priority:
 *  1. SMTP — když má uživatel v DB uložené SMTP integrace (provider="smtp").
 *     Používáme nodemailer. Heslo je šifrované AES-256-GCM.
 *  2. Resend HTTP API — fallback pro případy, kdy je RESEND_API_KEY v .env.
 *  3. Log — poslední záchrana (dev). Nic se nepošle, jen console.log.
 *
 * Resend free tier: 3 000 mailů / měsíc, 100 / den.
 * SMTP (Seznam/Gmail) má obvykle 100-500 mailů / den, bohatě stačí.
 */

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Volitelný štítek pro MailLog — např. "booking-confirm", "share-link", "backup-fail". */
  context?: string;
};

export type MailResult =
  | { ok: true; provider: "smtp" | "resend" | "log"; id?: string }
  | { ok: false; error: string };

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true pro 465, false pro 587 (STARTTLS)
  user: string;
  from: string;
}

// Cache pro transporter (nodemailer), aby se nevytvářel pool na každý mail.
let cachedTransporter: unknown = null;
let cachedTransporterKey: string | null = null;

async function getSmtpConfig(): Promise<{ config: SmtpConfig; password: string } | null> {
  // Single-user systém → najdi prvního userova SMTP config.
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) return null;

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: user.id, provider: "smtp" } },
  });
  if (!integration) return null;

  const cfg = integration.config as unknown as SmtpConfig | null;
  if (!cfg || !cfg.host || !cfg.user || !cfg.from) return null;

  const password = decryptSecret({
    enc: integration.tokenEnc,
    iv: integration.tokenIv,
    tag: integration.tokenTag,
  });

  return { config: cfg, password };
}

async function sendViaSmtp(input: MailInput, cfg: SmtpConfig, password: string): Promise<MailResult> {
  try {
    const nodemailer = await import("nodemailer");
    const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
    if (!cachedTransporter || cachedTransporterKey !== key) {
      cachedTransporter = nodemailer.default.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: password },
        // Seznam/většina providerů podporuje TLS 1.2+
      });
      cachedTransporterKey = key;
    }
    const transporter = cachedTransporter as {
      sendMail: (opts: Record<string, unknown>) => Promise<{ messageId: string }>;
    };
    const info = await transporter.sendMail({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    // Update lastUsedAt
    const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (user) {
      await prisma.userIntegration.updateMany({
        where: { userId: user.id, provider: "smtp" },
        data: { lastUsedAt: new Date(), lastError: null },
      });
    }

    return { ok: true, provider: "smtp", id: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "SMTP error";
    // Log error to DB for UI feedback
    const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }).catch(() => null);
    if (user) {
      await prisma.userIntegration
        .updateMany({
          where: { userId: user.id, provider: "smtp" },
          data: { lastError: msg },
        })
        .catch(() => null);
    }
    // Invalidate transporter cache (třeba se připojení zaseklo)
    cachedTransporter = null;
    cachedTransporterKey = null;
    return { ok: false, error: `SMTP: ${msg}` };
  }
}

async function sendViaResend(input: MailInput, apiKey: string, from: string): Promise<MailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, provider: "resend", id: data.id as string | undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Resend error" };
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  let result: MailResult;

  // 1) SMTP z DB
  try {
    const smtp = await getSmtpConfig();
    if (smtp) {
      result = await sendViaSmtp(input, smtp.config, smtp.password);
      await logMail(input, result);
      return result;
    }
  } catch (err) {
    console.error("[mailer] SMTP config lookup failed:", err);
  }

  // 2) Resend z .env
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFICATION_FROM;
  if (apiKey && from) {
    result = await sendViaResend(input, apiKey, from);
    await logMail(input, result);
    return result;
  }

  // 3) Log-only fallback
  console.log(
    `[mailer] Žádný transport nenakonfigurován. Mail by šel na ${input.to}:\n  subject: ${input.subject}\n  (html ${input.html.length} chars)`
  );
  result = { ok: true, provider: "log" };
  await logMail(input, result);
  return result;
}

/**
 * Persist do MailLog tabulky (Petr 2026-05-20).
 * Best-effort — pokud DB selže, mail-result se vrací beze změny.
 */
async function logMail(input: MailInput, result: MailResult): Promise<void> {
  try {
    await prisma.mailLog.create({
      data: {
        to: input.to,
        subject: input.subject,
        provider: result.ok ? result.provider : "unknown",
        ok: result.ok,
        providerId: result.ok ? result.id ?? null : null,
        error: result.ok ? null : result.error,
        context: input.context ?? null,
      },
    });
  } catch (e) {
    console.warn("[mailer] MailLog persist failed:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Ad-hoc test SMTP připojení bez skutečného odeslání.
 * Používá transporter.verify() → true pokud login OK, jinak throw.
 */
export async function testSmtpConnection(cfg: SmtpConfig, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: password },
    });
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP verify failed" };
  }
}

/**
 * HTML obálka pro analýzy — používá inline styly, aby fungovala ve všech
 * klientech (Gmail mobile, Apple Mail, Outlook).
 */
export function wrapAnalysisHtml(params: {
  title: string;
  periodFrom: Date;
  periodTo: Date;
  bodyHtml: string;
  meta: { days: number; totalSamples: number; metricsWithData: number; model: string };
}): string {
  const { title, periodFrom, periodTo, bodyHtml, meta } = params;
  const fmt = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#1a1714;color:#e8e3d9;font-family:-apple-system,BlinkMacSystemFont,'Geist','Segoe UI',sans-serif;line-height:1.55;">
  <div style="max-width:640px;margin:0 auto;padding:24px 20px;">
    <div style="background:#241f1b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:28px;">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b8763c;font-family:ui-monospace,monospace;margin-bottom:6px;">
        Rašeliniště · Zdraví
      </div>
      <h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 6px 0;color:#fff;letter-spacing:-0.01em;">
        ${title}
      </h1>
      <div style="font-size:13px;color:#9a8f82;font-family:ui-monospace,monospace;">
        ${fmt(periodFrom)} → ${fmt(periodTo)} · ${meta.days} dní · ${meta.totalSamples.toLocaleString("cs-CZ")} záznamů · ${meta.metricsWithData} metrik
      </div>

      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:20px 0;">

      <div style="font-size:15px;color:#e8e3d9;">
        ${bodyHtml}
      </div>

      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0 16px;">
      <div style="font-size:11px;color:#6b665f;font-family:ui-monospace,monospace;">
        Generováno ${meta.model} · automatický měsíční report z Rašeliniště
      </div>
    </div>
  </div>
</body>
</html>`;
}
