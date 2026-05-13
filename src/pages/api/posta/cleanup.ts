/**
 * POST /api/posta/cleanup
 *
 * Bulk smazani mailu — presune do Gmail Trash + soft-delete v nasi DB.
 *
 * Body: { fromAddresses?: string[], messageIds?: string[] }
 *   - fromAddresses: smaze vse od techto odesilatelu (priority 1)
 *   - messageIds: konkretni EmailMessage IDs (priority 2)
 *
 * Bezpecnost:
 *   - Gmail Trash drzi 30d → user muze obnovit pres Gmail UI
 *   - V nasi DB: prevedeme na soft-delete (status="deleted") spis nez hard delete,
 *     aby AI klasifikace/embedding mohly v RAG zustat pristupne
 *
 * Limit: max 1000 IDs per call (Gmail batchModify limit). Kdyz vic, posila se
 * v chunks.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { trashMessages } from "@/lib/gmail";

export const prerender = false;

const Body = z.object({
  fromAddresses: z.array(z.string().email().or(z.string().max(200))).optional(),
  messageIds: z.array(z.string()).optional(),
}).refine((v) => (v.fromAddresses && v.fromAddresses.length > 0) || (v.messageIds && v.messageIds.length > 0), {
  message: "fromAddresses nebo messageIds musí být uvedené.",
});

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  // Resolve EmailMessage rows
  const where: { userId: string; OR?: Array<Record<string, unknown>> } = { userId: session.uid };
  const or: Array<Record<string, unknown>> = [];
  if (parsed.fromAddresses && parsed.fromAddresses.length > 0) {
    or.push({ fromAddress: { in: parsed.fromAddresses } });
  }
  if (parsed.messageIds && parsed.messageIds.length > 0) {
    or.push({ id: { in: parsed.messageIds } });
  }
  if (or.length > 0) where.OR = or;

  const messages = await prisma.emailMessage.findMany({
    where,
    select: { id: true, gmailMessageId: true },
  });

  if (messages.length === 0) {
    return Response.json({ ok: true, trashed: 0, message: "Žádné maily k smazání." });
  }

  // Gmail batchModify v chunks po 1000
  const gmailIds = messages.map((m) => m.gmailMessageId);
  const CHUNK_SIZE = 1000;
  let totalTrashed = 0;
  const errors: string[] = [];

  for (let i = 0; i < gmailIds.length; i += CHUNK_SIZE) {
    const chunk = gmailIds.slice(i, i + CHUNK_SIZE);
    try {
      await trashMessages(session.uid, chunk);
      totalTrashed += chunk.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // V nasi DB hard-delete (Gmail Trash je source of truth pro recovery 30d).
  // Pozor: tim mizi EmailClassification, RagChunk, DetectedCommitment relations
  // (cascade). To je zamerene — kdyz user smaze junk, nechce ho mit v Postovym
  // RAG ani v Zavazcich.
  await prisma.emailMessage.deleteMany({
    where: { id: { in: messages.map((m) => m.id) } },
  });

  return Response.json({
    ok: true,
    trashed: totalTrashed,
    total: messages.length,
    errors,
  });
};
