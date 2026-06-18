import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { verifyMagicLink } from "@/lib/magic-link";
import { confirmReservation } from "@/lib/booking";

export const prerender = false;

/**
 * GET /api/booking/confirm?t=<magic-link-token>
 *
 * LEGACY ENDPOINT (2026-05-13).
 * Magic-link confirm flow byl 2026-05-12 globálně vypnut — reserveSlot()
 * teď rovnou vytvoří Google event. Tento endpoint zůstává jen pro
 * zpětnou kompatibilitu, kdyby měl někdo v inboxu mail s odkazem
 * z doby před změnou. Po pár dnech se může smazat úplně.
 *
 * Reálně tedy obvykle vrátí "už potvrzeno" (confirmReservation vyhodí
 * tu hlášku pro CONFIRMED status).
 */
export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get("t");
  if (!t) return htmlError("Odkaz není kompletní.");

  const verified = verifyMagicLink(t);
  if (!verified) return htmlError("Odkaz není platný nebo už neplatí.");

  const owner = await prisma.user.findFirst({ select: { id: true } });
  if (!owner) return htmlError("Systémová chyba — kontaktujte odesílatele.");

  try {
    const result = await confirmReservation(verified.inviteId, owner.id);
    return new Response(htmlSuccess(result.meetLink), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "Termín už je potvrzený" je vlastně success path pro legacy linky —
    // user kliká podruhé (nebo flow už proběhl v UI bez něj).
    if (msg.includes("už je potvrzen") || msg.includes("už potvrzen")) {
      return new Response(htmlAlreadyConfirmed(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return htmlError(msg);
  }
};

/**
 * Inline HTML stránka — sjednocený design s Astro layoutem (dark + glass).
 * Texty neutrální (Petr 2026-05-13: žádné tykání, žádné "Můžeš zavřít").
 */
function htmlPage(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Rašeliniště</title>
<style>
  :root {
    --bg: oklch(14% 0.025 260);
    --fg: oklch(98% 0.005 260);
    --muted: oklch(78% 0.01 260);
    --border: oklch(98% 0.005 260 / 0.1);
    --sage: oklch(78% 0.08 145);
    --rose: oklch(72% 0.12 15);
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--bg);
    color: var(--fg);
    min-height: 100vh;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background-image:
      radial-gradient(at 20% 30%, oklch(70% 0.07 30 / 0.08) 0px, transparent 50%),
      radial-gradient(at 80% 70%, oklch(70% 0.07 280 / 0.08) 0px, transparent 50%);
  }
  .card {
    max-width: 480px;
    width: 100%;
    background: oklch(98% 0.005 260 / 0.045);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    box-shadow: 0 24px 48px oklch(0% 0 0 / 0.4), inset 0 1px 0 oklch(100% 0 0 / 0.06);
  }
  h1 {
    font-family: "Fraunces", Georgia, serif;
    font-size: 24px;
    font-weight: 500;
    margin: 0 0 12px;
  }
  p { color: var(--muted); line-height: 1.5; margin: 8px 0; font-size: 15px; }
  .icon { font-size: 56px; margin-bottom: 8px; line-height: 1; }
  a.btn {
    display: inline-block;
    margin-top: 16px;
    padding: 12px 24px;
    background: oklch(78% 0.08 145 / 0.18);
    color: var(--sage);
    text-decoration: none;
    border-radius: 8px;
    font-weight: 500;
    border: 1px solid oklch(78% 0.08 145 / 0.3);
  }
  a.btn:hover { background: oklch(78% 0.08 145 / 0.25); }
  .hint { color: oklch(78% 0.01 260 / 0.6); font-size: 13px; margin-top: 20px; }
</style>
</head><body><div class="card">${body}</div></body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlError(msg: string): Response {
  return htmlPage("Chyba",
    `<div class="icon" style="color:var(--rose)">⚠</div>
<h1>Pozvánku nelze potvrdit</h1>
<p>${escapeHtml(msg)}</p>
<p class="hint">Pro nový termín kontaktujte odesílatele pozvánky.</p>`,
  );
}

function htmlAlreadyConfirmed(): Response {
  return htmlPage("Termín potvrzen",
    `<div class="icon" style="color:var(--sage)"></div>
<h1>Termín je už potvrzen</h1>
<p>Pozvánka byla zaslaná mailem z Google Kalendáře.</p>
<p class="hint">Tuto stránku lze zavřít.</p>`,
  );
}

function htmlSuccess(meetLink: string | null): string {
  return `<div class="icon" style="color:var(--sage)"></div>
<h1>Termín potvrzen</h1>
<p>Pozvánka přijde mailem z Google Kalendáře.</p>
${meetLink ? `<p><a class="btn" href="${escapeHtml(meetLink)}">Otevřít Google Meet</a></p>` : ""}
<p class="hint">Tuto stránku lze zavřít.</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
