/**
 * GET  /api/contacts/backups — list posledních 80 záloh
 * POST /api/contacts/backups/restore { backupId } — obnoví zálohu
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { listBackups, restoreBackup } from "@/lib/contacts-backup";

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const backups = await listBackups(session.uid);
  return Response.json({ ok: true, backups });
};

const RestoreBody = z.object({ backupId: z.string().min(1) });

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof RestoreBody>;
  try {
    body = RestoreBody.parse(await request.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "INVALID" }, { status: 400 });
  }

  const result = await restoreBackup(session.uid, body.backupId);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
};
