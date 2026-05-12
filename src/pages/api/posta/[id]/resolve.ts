import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { invalidatePostaBadgeCache } from "@/lib/posta-badge";

export const prerender = false;

/**
 * POST /api/posta/:id/resolve
 *
 * Označí EmailMessage jako vyřízené. Formulářové action z /posta karty —
 * HTML <form method="POST" action="..."> bez JS islandu. Po success
 * redirect zpátky na /posta (zachová filter z `from` query).
 *
 * Formulářové pole `from` může být relativní cesta (s query stringem) kam
 * se má redirect — default "/posta".
 */
export const POST: APIRoute = async ({ params, cookies, request, redirect }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const email = await prisma.emailMessage.findFirst({
    where: { id, userId: session.uid },
    select: { id: true, resolvedAt: true },
  });
  if (!email) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!email.resolvedAt) {
    await prisma.emailMessage.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedReason: "manual" },
    });
    invalidatePostaBadgeCache(session.uid);
  }

  // Redirect zpátky — z formuláře přijde `from` field s URL.
  const form = await request.formData().catch(() => null);
  const back = (form?.get("from") as string | null) || "/posta";
  // Safety — povolíme jen relativní cesty (žádný open redirect)
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/posta";
  return redirect(safeBack);
};
