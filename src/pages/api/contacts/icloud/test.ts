/**
 * POST /api/contacts/icloud/test
 *
 * Otestuje CardDAV připojení k iCloudu. Vrátí počet kontaktů v addressbooku.
 * Použito v `/settings/integrations/icloud` před prvním sync.
 */

import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { getIcloudCredentials } from "@/lib/icloud-contacts";
import { testConnection } from "@/lib/carddav";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const creds = await getIcloudCredentials(session.uid);
  if (!creds) {
    return Response.json(
      { ok: false, error: "iCloud credentials nejsou nakonfigurované. Doplň Apple ID + app password v Nastavení > Integrace > iCloud (sekce kalendář)." },
      { status: 400 },
    );
  }

  const result = await testConnection(creds);
  return Response.json(result);
};
