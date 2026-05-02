import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { ensureCallLogToken } from "@/lib/call-log-token";

export const prerender = false;

/**
 * POST /api/contacts/backfill-tokens
 *
 * Pro každý VIP kontakt bez callLogToken vygeneruje token. Idempotentní —
 * pokud kontakt už token má, přeskočí. Použít po deployi callLogToken commitu
 * pro existující VIP kontakty které byly VIP už před deployem.
 *
 * Vrátí počet vygenerovaných tokenů + seznam jmen.
 */
export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const vipsWithoutToken = await prisma.contact.findMany({
    where: { userId: session.uid, isVip: true, callLogToken: null },
    select: { id: true, displayName: true },
  });

  const generated: { id: string; displayName: string; token: string | null }[] = [];
  for (const c of vipsWithoutToken) {
    try {
      const token = await ensureCallLogToken(c.id);
      generated.push({ id: c.id, displayName: c.displayName, token });
    } catch (e) {
      console.warn(`[backfill-tokens] ${c.id} (${c.displayName}) failed:`, e instanceof Error ? e.message : String(e));
      generated.push({ id: c.id, displayName: c.displayName, token: null });
    }
  }

  return Response.json({
    ok: true,
    processed: vipsWithoutToken.length,
    generated: generated.filter((g) => g.token),
    failed: generated.filter((g) => !g.token),
  });
};
