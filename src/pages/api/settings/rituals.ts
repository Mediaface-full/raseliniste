import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  morning_day: z.string().max(8000).nullable().optional(),
  friday_reflection: z.string().max(8000).nullable().optional(),
  weekly_review: z.string().max(8000).nullable().optional(),
});

/**
 * PATCH /api/settings/rituals — uloží uživatelské popisy rituálů.
 * Prázdné/null value = vrátit default z kódu.
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

  // Vyčisti — ulož jen non-empty hodnoty. Pokud všechny null/prázdné, ulož null.
  const cleaned: Record<string, string> = {};
  for (const key of ["morning_day", "friday_reflection", "weekly_review"] as const) {
    const v = body[key]?.trim();
    if (v && v.length > 0) cleaned[key] = v;
  }

  await prisma.user.update({
    where: { id: session.uid },
    data: { ritualTemplates: Object.keys(cleaned).length > 0 ? cleaned : null },
  });

  return Response.json({ ok: true, templates: cleaned });
};
