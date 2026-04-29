import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { verifyMagicLink } from "@/lib/magic-link";
import { confirmReservation } from "@/lib/booking";

export const prerender = false;

/**
 * GET /api/booking/confirm?t=<magic-link-token>
 * Klient klikne v mailu → potvrdíme rezervaci → vytvoříme Google event.
 *
 * Public endpoint, autorizace přes HMAC-podepsaný magic-link token.
 * Po confirm redirect na thank-you page.
 */
export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get("t");
  if (!t) return htmlError("Chybí token v URL.");

  const verified = verifyMagicLink(t);
  if (!verified) return htmlError("Odkaz není platný nebo expiroval. Pošli mi prosím novou pozvánku.");

  // Pro single-user: ownerUserId = jediný user v systému
  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) return htmlError("Vlastník systému nebyl nalezen.");

  try {
    const result = await confirmReservation(verified.inviteId, owner.id);
    return new Response(htmlSuccess(result.meetLink), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return htmlError(e instanceof Error ? e.message : String(e));
  }
};

function htmlPage(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Rašeliniště</title>
<style>
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; background: #0c1126; color: #f0f0f5; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 480px; background: rgba(255,255,255,0.05); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: center; }
  h1 { font-family: Georgia, serif; font-size: 24px; margin: 0 0 12px; }
  p { color: #c0c0d0; line-height: 1.5; margin: 8px 0; }
  .icon { font-size: 64px; margin-bottom: 8px; }
  a.btn { display: inline-block; margin-top: 16px; padding: 12px 24px; background: rgba(166, 219, 178, 0.2); color: #a6dbb2; text-decoration: none; border-radius: 8px; font-weight: 500; }
</style>
</head><body><div class="card">${body}</div></body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlError(msg: string): Response {
  return htmlPage("Chyba",
    `<div class="icon">⚠</div><h1>Něco se nepodařilo</h1><p>${escapeHtml(msg)}</p>`,
  );
}

function htmlSuccess(meetLink: string | null): string {
  return `<div class="icon">✓</div>
<h1>Termín potvrzený</h1>
<p>Pozvánka přijde na e-mail z Google Calendaru.</p>
${meetLink ? `<p><a class="btn" href="${escapeHtml(meetLink)}">Otevřít Google Meet</a></p>` : ""}
<p style="color:#888;font-size:13px;margin-top:24px">Můžeš tuto stránku zavřít.</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
