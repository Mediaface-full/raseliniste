/**
 * POST /api/studna/recordings/delete-empty-audio
 *
 * Petr 2026-05-14: po fix MIME a retry zůstávají nahrávky s 0-byte audio
 * (cleanup-audio cron je smazal po 14 dnech, klient nahrál prazdný blob,
 * atd.). Nelze je obnovit — tahle utilitka je smaze.
 *
 * Najde ProjectRecording where status=error AND (audioPath neexistuje
 * NEBO soubor má 0 bytes) → delete row z DB.
 *
 * Vraci souhrn { deleted, scanned, details }.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { uploadExists, resolveUpload } from "@/lib/uploads";
import { stat } from "node:fs/promises";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const errored = await prisma.projectRecording.findMany({
    where: {
      status: "error",
      project: { userId: session.uid },
    },
    select: { id: true, audioPath: true, audioBytes: true, authorName: true, createdAt: true },
  });

  const toDelete: Array<{ id: string; reason: string; audioBytes: number | null }> = [];

  for (const r of errored) {
    if (!r.audioPath) {
      toDelete.push({ id: r.id, reason: "no audioPath", audioBytes: r.audioBytes });
      continue;
    }
    const exists = await uploadExists(r.audioPath);
    if (!exists) {
      toDelete.push({ id: r.id, reason: "audio missing on disk", audioBytes: r.audioBytes });
      continue;
    }
    try {
      const s = await stat(resolveUpload(r.audioPath));
      if (s.size === 0) {
        toDelete.push({ id: r.id, reason: "0-byte audio file", audioBytes: r.audioBytes });
      }
    } catch {
      toDelete.push({ id: r.id, reason: "stat failed", audioBytes: r.audioBytes });
    }
  }

  if (toDelete.length > 0) {
    await prisma.projectRecording.deleteMany({
      where: { id: { in: toDelete.map((t) => t.id) } },
    });
  }

  return Response.json({
    ok: true,
    scanned: errored.length,
    deleted: toDelete.length,
    details: toDelete.slice(0, 30),
  });
};
