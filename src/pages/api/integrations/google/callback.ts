import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { handleCallback } from "@/lib/google-oauth";
import { syncGoogleCalendar } from "@/lib/google-calendar";

export const prerender = false;

/**
 * GET /api/integrations/google/callback?code=...&state=...
 *
 * Google nás po consent volá s code+state. Ověříme state proti cookie,
 * vyměníme code za refresh_token a uložíme. Pak provedeme první sync
 * v pozadí (fire-and-forget) a redirect na settings.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { location: "/login" },
    });
  }

  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const stateCookie = cookies.get("google_oauth_state")?.value;

  if (!code) {
    return new Response("Missing code", { status: 400 });
  }
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return new Response("Invalid state — restart OAuth flow.", { status: 400 });
  }

  try {
    await handleCallback(session.uid, code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`OAuth selhalo: ${msg}`, { status: 500 });
  }

  // Smaž state cookie
  cookies.delete("google_oauth_state", { path: "/" });

  // Fire-and-forget první sync (na pozadí, nečekáme)
  syncGoogleCalendar(session.uid).catch((e) =>
    console.error("[google-callback] initial sync failed:", e),
  );

  return new Response(null, {
    status: 302,
    headers: { location: "/settings/integrations/google?just_connected=1" },
  });
};
