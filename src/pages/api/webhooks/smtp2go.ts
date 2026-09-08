import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const prerender = false;

/**
 * POST /api/webhooks/smtp2go?key=<SMTP2GO_WEBHOOK_SECRET>
 *
 * Gideon 2026-09-08 (Poláková „nepřišlo potvrzení"): náš MailLog hlásil ok=true,
 * protože SMTP2GO mail PŘEVZAL — a pak ho sám zahodil (adresa na suppression
 * listu po hard-bounce). Log tak neříkal pravdu. Tenhle webhook propisuje
 * skutečný osud zprávy (reject / bounce / spam / delivered) do MailLogu.
 *
 * Nastavení v SMTP2GO: Settings → Webhooks → URL
 *   https://www.raseliniste.cz/api/webhooks/smtp2go?key=…  events: Rejected,
 *   Bounced, Spam complaint, Delivered. Payload je JSON (tolerantně parsujeme
 *   i pole/urlencoded), klíče se u SMTP2GO liší podle typu události.
 */
type Ev = Record<string, unknown>;

function pick(ev: Ev, keys: string[]): string | null {
  for (const k of keys) {
    const v = ev[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function parseBody(request: Request): Promise<Ev[]> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = await request.json().catch(() => null);
    if (Array.isArray(j)) return j as Ev[];
    if (j && typeof j === "object") return [j as Ev];
    return [];
  }
  const text = await request.text();
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? (j as Ev[]) : [j as Ev];
  } catch {
    const params = new URLSearchParams(text);
    const ev: Ev = {};
    params.forEach((v, k) => { ev[k] = v; });
    return Object.keys(ev).length ? [ev] : [];
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.SMTP2GO_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  if (url.searchParams.get("key") !== secret) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const events = await parseBody(request);
  let updated = 0, created = 0, ignored = 0;

  for (const ev of events) {
    const event = (pick(ev, ["event", "event_type", "type"]) ?? "").toLowerCase();
    const rcpt = pick(ev, ["rcpt", "recipient", "email", "to"])?.toLowerCase();
    if (!rcpt) { ignored++; continue; }
    const messageId = pick(ev, ["message-id", "message_id", "Message-Id", "messageid"])?.replace(/^<|>$/g, "") ?? null;
    const subject = pick(ev, ["subject"]);
    const reason = pick(ev, ["reason", "bounce_reason", "error", "message", "description", "smtp_response"]);
    const bad = /reject|bounce|spam|fail|block|unsub/.test(event);
    const good = /deliver/.test(event);
    if (!bad && !good) { ignored++; continue; }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const row = await prisma.mailLog.findFirst({
      where: {
        to: rcpt,
        createdAt: { gte: since },
        ...(messageId ? { providerId: { contains: messageId } } : subject ? { subject } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const errorText = bad ? `[smtp2go ${event}] ${reason ?? "bez důvodu"}`.slice(0, 2000) : null;
    if (row) {
      await prisma.mailLog.update({
        where: { id: row.id },
        data: bad
          ? { ok: false, error: errorText, provider: "smtp2go" }
          : { ok: true, error: null, provider: "smtp2go-delivered" },
      });
      updated++;
    } else {
      await prisma.mailLog.create({
        data: { to: rcpt, subject: subject ?? "(neznámý předmět)", provider: bad ? "smtp2go" : "smtp2go-delivered", ok: !bad, providerId: messageId, error: errorText, context: "smtp2go-webhook" },
      });
      created++;
    }
    if (bad) console.warn(`[smtp2go-webhook] ${event} → ${rcpt}: ${reason ?? "?"}`);
  }

  return Response.json({ ok: true, received: events.length, updated, created, ignored });
};
