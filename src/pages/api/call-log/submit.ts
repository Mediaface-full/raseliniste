import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { decryptSecret } from "@/lib/crypto";
import { createTask } from "@/lib/todoist";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

export const prerender = false;

const Body = z.object({
  phone: z.string().min(3).max(30),
  message: z.string().min(3).max(1000),
  isUrgent: z.boolean().optional().default(false),
  // VIP-only termín splnění (YYYY-MM-DD). Server stejně ignoruje pokud volající
  // není VIP — proti pokusu o privilege bypass přes nezavolaný formulář.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  website: z.string().optional(), // honeypot
});

function clientIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}

// Rate limit: max 5 submissions za 10 min per IP (anti-spam).
async function checkRateLimit(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const count = await prisma.callLog.count({
    where: { ip, createdAt: { gte: since } },
  });
  return count < 5;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "Neplatná data ve formuláři." }, { status: 400 });
  }

  // Honeypot — bot vyplní skryté pole.
  if (body.website && body.website.trim() !== "") {
    return Response.json({ ok: true }, { status: 200 }); // pretend success
  }

  const ip = clientIp(request, clientAddress);
  const ua = request.headers.get("user-agent") ?? null;

  // Rate limit per IP
  const okLimit = await checkRateLimit(ip);
  if (!okLimit) {
    return Response.json(
      { error: "Moc zpráv za krátkou dobu. Zkus to prosím za 10 minut." },
      { status: 429 }
    );
  }

  // Normalizace čísla
  const normalized = normalizePhone(body.phone);
  if (!normalized) {
    return Response.json({ error: "Neplatné telefonní číslo." }, { status: 400 });
  }

  // Single-user system — najdi prvního (jediného) uživatele.
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    return Response.json({ error: "Systém není nastaven." }, { status: 500 });
  }

  // Najdi kontakt podle telefonu
  const phoneRecord = await prisma.phone.findFirst({
    where: { number: normalized, contact: { userId: user.id } },
    include: { contact: true },
  });

  const contact = phoneRecord?.contact ?? null;
  const wasVip = contact?.isVip ?? false;

  // Datum splnění je VIP-only privilegium. Pokud volající není VIP, ignoruj
  // (mohl by ho podsunout v requestu i když na ne-VIP variantě stránky pole není).
  // Min = dnes + 2 dny (Gideon potřebuje rezervu).
  let requestedDueAt: Date | null = null;
  if (wasVip && body.dueDate) {
    const parsed = new Date(`${body.dueDate}T00:00:00`);
    if (!isNaN(parsed.getTime())) {
      const now = new Date();
      const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
      const maxFuture = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
      if (parsed >= minDate && parsed <= maxFuture) {
        requestedDueAt = parsed;
      }
    }
  }

  // Vytvoř CallLog (snapshot)
  const callLog = await prisma.callLog.create({
    data: {
      userId: user.id,
      phoneNumber: normalized,
      rawNumber: body.phone,
      contactId: contact?.id ?? null,
      message: body.message.trim(),
      isUrgent: body.isUrgent,
      wasVip,
      requestedDueAt,
      ip,
      userAgent: ua,
    },
  });

  // ====== Todoist push ======
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: user.id, provider: "todoist" } },
  });

  let todoistTaskId: string | null = null;
  let todoistProjectId: string | null = null;
  let todoistError: string | null = null;

  if (integration) {
    try {
      const token = decryptSecret({
        enc: integration.tokenEnc,
        iv: integration.tokenIv,
        tag: integration.tokenTag,
      });
      const cfg = (integration.config ?? {}) as { vyruseni?: string; vip?: string };
      const projectId = wasVip ? cfg.vip : cfg.vyruseni;

      const prettyPhone = formatPhone(normalized);
      const who = contact?.displayName ?? prettyPhone;
      const priority: 1 | 2 | 3 | 4 = wasVip ? 4 : body.isUrgent ? 3 : 2;

      // Title úkolu v Todoistu:
      //   - VIP   = mise/úkol → "⭐ Karel: <obsah zprávy zhuštěný>"
      //             Petr v Todoist liste vidí O ČEM úkol je, ne koho volat.
      //   - NeVIP = klasický callback → "Zavolat zpět X" (případně ⚠️ pro urgent).
      const content = wasVip
        ? `⭐ ${who}: ${truncateForTitle(body.message.trim(), 80)}`
        : `${body.isUrgent ? "⚠️ " : ""}Zavolat zpět ${who}`;
      const description = [
        `**${body.message.trim()}**`,
        "",
        `Číslo: ${prettyPhone}`,
        contact ? `Kontakt: ${contact.displayName}${wasVip ? " (VIP)" : ""}` : "Neznámé číslo",
        requestedDueAt ? `📅 **Termín požadovaný od VIP:** ${requestedDueAt.toLocaleDateString("cs-CZ")}` : "",
        body.isUrgent ? "⚠️ Označeno jako **urgentní**" : "",
        `Přijato: ${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}`,
        `Firewall: https://www.raseliniste.cz/firewall`,
      ]
        .filter(Boolean)
        .join("\n");

      // Termín:
      //   1. VIP zadal konkrétní datum  → due_date YYYY-MM-DD
      //   2. VIP nebo urgent bez data   → due_string "today"
      //   3. Ostatní                    → bez termínu
      const dueArgs: { due_date?: string; due_string?: string } = {};
      if (requestedDueAt) {
        dueArgs.due_date = requestedDueAt.toISOString().slice(0, 10);
      } else if (wasVip || body.isUrgent) {
        dueArgs.due_string = "today";
      }

      const task = await createTask(token, {
        content,
        description,
        project_id: projectId,
        priority,
        ...dueArgs,
        labels: ["firewall", wasVip ? "vip" : "vyruseni"],
      });
      todoistTaskId = task.id;
      todoistProjectId = task.project_id;

      // Update integration lastUsedAt
      await prisma.userIntegration.update({
        where: { id: integration.id },
        data: { lastUsedAt: new Date(), lastError: null },
      });
    } catch (e) {
      todoistError = e instanceof Error ? e.message : String(e);
      await prisma.userIntegration.update({
        where: { id: integration.id },
        data: { lastError: todoistError },
      });
    }
  } else {
    todoistError = "Todoist integrace není nakonfigurovaná.";
  }

  // ====== Email pokud VIP nebo urgent ======
  let mailSentAt: Date | null = null;
  let mailError: string | null = null;

  const shouldMail = wasVip || body.isUrgent;
  if (shouldMail) {
    const to = user.notificationEmail ?? env.NOTIFICATION_EMAIL;
    if (to) {
      const prettyPhone = formatPhone(normalized);
      const who = contact?.displayName ?? "Neznámé číslo";
      const subject = wasVip
        ? `⭐ VIP vzkaz od ${who}`
        : `⚠️ Urgentní vzkaz od ${who}`;

      const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#1a1714;color:#e8e3d9;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#241f1b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
  <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${wasVip ? "#f4a4c7" : "#d4a373"};font-family:ui-monospace,monospace;margin-bottom:6px;">
    Rašeliniště · Firewall ${wasVip ? "· VIP" : "· Urgent"}
  </div>
  <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px 0;color:#fff;">${who}</h1>
  <div style="font-size:14px;color:#9a8f82;font-family:ui-monospace,monospace;margin-bottom:16px;">${prettyPhone}</div>
  <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:14px;font-size:15px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(body.message)}</div>
  <div style="margin-top:20px;font-size:12px;color:#6b665f;">
    ${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })} · IP ${ip}
  </div>
  <a href="https://www.raseliniste.cz/firewall" style="display:inline-block;margin-top:16px;padding:10px 16px;background:#b8763c;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">Otevřít Firewall</a>
</div>
</body></html>`;

      const text = `${subject}\n\n${body.message}\n\nČíslo: ${prettyPhone}\n${new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}`;

      const r = await sendMail({ to, subject, html, text });
      if (r.ok) {
        mailSentAt = new Date();
      } else {
        mailError = r.error;
      }
    } else {
      mailError = "Notifikační email není nastaven.";
    }
  }

  // Update CallLog s výsledky
  await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      todoistTaskId,
      todoistProjectId,
      todoistError,
      mailSentAt,
      mailError,
    },
  });

  return Response.json({ ok: true }, { status: 200 });
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Zhuštění zprávy pro title úkolu v Todoistu — max N znaků, dělí na hranici slova,
 * přidá výpustku „…". Použito jen pro VIP misi (kontext úkolu jako title).
 */
function truncateForTitle(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
