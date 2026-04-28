import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { saveCredentials, disconnect, getStatus } from "@/lib/icloud-calendar";

export const prerender = false;

/**
 * GET    /api/integrations/icloud   — status (connected, vybrané kalendáře, počty)
 * POST   /api/integrations/icloud   — uložit Apple ID + app password
 * DELETE /api/integrations/icloud   — disconnect
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const status = await getStatus(session.uid);
  return Response.json(status);
};

const credsSchema = z.object({
  appleId: z.string().email("Apple ID musí být email"),
  appPassword: z
    .string()
    .min(15, "App-specific password je 16 znaků (formát xxxx-xxxx-xxxx-xxxx)"),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = credsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // Pokud heslo obsahuje pomlčky (Apple to nevyžaduje), odstraňujeme je —
  // CalDAV server akceptuje obě varianty, ale konzistentně ukládáme bez pomlček.
  const cleanPassword = parsed.data.appPassword.replace(/\s|-/g, "");

  try {
    await saveCredentials(session.uid, parsed.data.appleId, cleanPassword);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};

export const DELETE: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  await disconnect(session.uid);
  return Response.json({ ok: true });
};
