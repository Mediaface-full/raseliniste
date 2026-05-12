import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { invalidatePostaBadgeCache } from "@/lib/posta-badge";

export const prerender = false;

/**
 * POST /api/posta/:id/unresolve — undo "označit jako vyřízené".
 * Stejný form pattern jako resolve.ts.
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

  if (email.resolvedAt) {
    await prisma.emailMessage.update({
      where: { id },
      data: { resolvedAt: null, resolvedReason: null },
    });
    invalidatePostaBadgeCache(session.uid);
  }

  const form = await request.formData().catch(() => null);
  const back = (form?.get("from") as string | null) || "/posta";
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/posta";
  return redirect(safeBack);
};
