import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE } from "./lib/session";

// Public stránky a endpointy, které nevyžadují session cookie.
// Passkey flow má svou vlastní autorizaci přes rs_preauth cookie (JWT po hesle).
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  // Gideonův Firewall — veřejná landing pro volající.
  "/call-log",
  "/call-log/thanks",
  "/api/call-log/submit",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_astro/")) return true;
  if (pathname.startsWith("/api/auth/logout")) return true;
  if (pathname.startsWith("/api/auth/passkey/")) return true;
  // /api/ingest má svou vlastní Bearer token autorizaci (mobile shortcut).
  if (pathname === "/api/ingest") return true;
  // /api/journal/ingest — direct JOURNAL write s Bearer/x-api-key.
  if (pathname === "/api/journal/ingest") return true;
  // /api/health-ingest používá x-api-key (Health Auto Export z iPhonu).
  if (pathname === "/api/health-ingest") return true;
  // Cron endpointy mají vlastní x-cron-key autorizaci.
  if (pathname.startsWith("/api/cron/")) return true;
  // GoSMS webhooky (doručenky + odpovědi) — autorizace přes ?token=<webhookSecret>
  if (pathname.startsWith("/api/webhooks/gosms/")) return true;
  // Pošta — Gmail Pub/Sub push webhook (autorizace přes OIDC JWT v Authorization header)
  if (pathname === "/api/posta/gmail-webhook") return true;
  // Studna — pozvánkové linky pro hosty (autorizace přes guestToken v URL).
  if (pathname.startsWith("/me/")) return true;
  if (pathname.startsWith("/api/me/")) return true;
  // Booking — public klient stránky a public booking endpointy.
  // /schuzka byla 2026-05-13 smazána (Petr: "nedávám pozvánky veřejně"),
  // public booking jen přes personalizovaný link /i/<token>.
  if (pathname.startsWith("/i/")) return true;
  if (pathname.startsWith("/api/booking/by-token/")) return true;
  if (pathname === "/api/booking/reserve") return true;
  if (pathname === "/api/booking/confirm") return true;
  return false;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // microphone=(self) — povoluje mikrofon pro NAŠE stránky (Studna, Ozvěna, /me/<token>),
  //   blokuje pro všechny embed/iframe.
  // camera=() — blokováno (zatím nepotřebujeme).
  // geolocation=() — blokováno (geolocation v Shortcutu jde přes JSON, ne browser API).
  // PŘEDTÍM: microphone=() = úplný block. iOS Safari to ignoroval, Android Chrome
  // striktně dodržoval → klienti na Androidu (Blanka) viděli stránku ale tap na mikrofon
  // nereagoval. Standard W3C Permissions-Policy: () = empty allowlist = blokováno všem
  // včetně self. Pro povolení same-origin musí být (self).
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

function applySecurityHeaders(response: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(k)) response.headers.set(k, v);
  }
  return response;
}

/**
 * Kanonická doména — všechen traffic směřujeme sem.
 * Pokud jde z jiného hostname (typicky apex `raseliniste.cz`), pošleme 301.
 * Reverse proxy na DSM ale musí propouštět správné Host header (nepřepisovat
 * ho na `localhost`). Pokud Host je localhost (interní vývoj), nereagujeme.
 */
const CANONICAL_HOST = "www.raseliniste.cz";

function apexRedirect(request: Request, url: URL): Response | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;
  // Lokalhost a IP adresy necháváme (dev + interní testy)
  if (host.startsWith("localhost") || host.startsWith("127.") || /^\d+\.\d+\.\d+\.\d+/.test(host)) {
    return null;
  }
  // Už jsme na kanonické doméně — nic nedělat
  if (host === CANONICAL_HOST) return null;
  // Redirect na kanonickou doménu se stejnou cestou
  const target = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
  return new Response(null, {
    status: 301,
    headers: { Location: target },
  });
}

export const onRequest = defineMiddleware(async ({ request, cookies, url, redirect }, next) => {
  // Apex → www 301 před vším ostatním (cookies, passkey vázané na hostname)
  const apexRedir = apexRedirect(request, url);
  if (apexRedir) return apexRedir;

  if (isPublic(url.pathname)) {
    return applySecurityHeaders(await next());
  }

  const hasCookie = Boolean(cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) {
    // Skutečné ověření (JWT + DB session) si každá stránka/API ještě dělá sama
    // přes readSession() — middleware je jen optimistic check.
    return applySecurityHeaders(await next());
  }

  // API → 401 JSON; stránky → redirect na login.
  if (url.pathname.startsWith("/api/")) {
    return applySecurityHeaders(
      new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
  }
  return redirect("/login");
});
