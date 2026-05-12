import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { invalidatePostaBadgeCache } from "@/lib/posta-badge";

export const prerender = false;

/**
 * DELETE /api/posta/emails/:id
 *
 * Query params:
 *   - full=true  → smaže VŠECHNO (EmailMessage row + cascade classification +
 *                   chunks + embeddings) + audit log do PostaDeletionLog
 *   - bez full   → soft delete (alias pro resolve, ne hard delete)
 *
 * Body (volitelný, JSON):
 *   { reason?: string }   — uloží se do audit logu
 *
 * Per Petrovo zadání fáze 5: pro GDPR-style requesty / mistake recovery.
 * Audit log zůstává navždy (right to be forgotten WITH evidence).
 */
export const DELETE: APIRoute = async ({ params, cookies, url, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const isFullDelete = url.searchParams.get("full") === "true";

  let reason: string | undefined;
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { reason?: string } | null;
      reason = body?.reason;
    }
  } catch {
    // body je volitelný
  }

  const email = await prisma.emailMessage.findFirst({
    where: { id, userId: session.uid },
    select: {
      id: true,
      gmailMessageId: true,
      threadId: true,
      subject: true,
      fromAddress: true,
      receivedAt: true,
    },
  });
  if (!email) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!isFullDelete) {
    // Soft delete = mark resolved + reason=manual-delete
    await prisma.emailMessage.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedReason: "soft-delete" },
    });
    invalidatePostaBadgeCache(session.uid);
    return Response.json({ ok: true, mode: "soft" });
  }

  // FULL DELETE — destructive, audit log first
  const chunksDeleted = await prisma.ragChunk.deleteMany({
    where: { sourceType: "email", sourceId: id },
  });

  // Audit log (insert BEFORE delete row aby snapshot byl správný)
  await prisma.postaDeletionLog.create({
    data: {
      userId: session.uid,
      emailId: id,
      gmailMessageId: email.gmailMessageId,
      threadId: email.threadId,
      subject: email.subject,
      fromAddress: email.fromAddress,
      receivedAt: email.receivedAt,
      requestedBy: session.uid,
      reason: reason?.slice(0, 1000),
      chunksDeleted: chunksDeleted.count,
    },
  });

  // Smaž email + cascade (EmailClassification přes onDelete:Cascade FK)
  await prisma.emailMessage.delete({ where: { id } });

  // Volitelně: smaž PostaEmbedFailure záznamy
  await prisma.postaEmbedFailure
    .deleteMany({ where: { emailId: id } })
    .catch(() => null);

  invalidatePostaBadgeCache(session.uid);

  return Response.json({
    ok: true,
    mode: "full",
    chunksDeleted: chunksDeleted.count,
  });
};
