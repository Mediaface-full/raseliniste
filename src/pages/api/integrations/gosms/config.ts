import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import {
  loadGosmsCredentials,
  getOrganization,
  type GosmsConfig,
} from "@/lib/gosms";

export const prerender = false;

const Body = z.object({
  defaultChannel: z.number().int().positive().nullable().optional(),
  refresh: z.boolean().optional(),
});

/**
 * PATCH — aktualizovat config (default channel) nebo vyžádat refresh organizace.
 * Vrací aktuální organization (z cache nebo čerstvě načtenou).
 */
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const loaded = await loadGosmsCredentials(session.uid);
  if (!loaded) {
    return Response.json({ error: "GoSMS není nakonfigurováno." }, { status: 400 });
  }

  const config: GosmsConfig = { ...loaded.config };

  if (body.defaultChannel !== undefined) {
    config.defaultChannel = body.defaultChannel ?? undefined;
  }

  if (body.refresh) {
    try {
      const org = await getOrganization(session.uid, loaded.creds);
      config.organization = org;
      config.organizationFetchedAt = new Date().toISOString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.userIntegration.update({
        where: { userId_provider: { userId: session.uid, provider: "gosms" } },
        data: { lastError: msg },
      });
      return Response.json({ error: `Nepodařilo se načíst organizaci: ${msg}` }, { status: 500 });
    }
  }

  await prisma.userIntegration.update({
    where: { userId_provider: { userId: session.uid, provider: "gosms" } },
    data: {
      config: config as unknown as object,
      lastUsedAt: body.refresh ? new Date() : undefined,
      lastError: body.refresh ? null : undefined,
    },
  });

  return Response.json({ ok: true, config });
};
