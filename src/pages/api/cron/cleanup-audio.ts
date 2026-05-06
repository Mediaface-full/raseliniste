import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteUpload } from "@/lib/uploads";

export const prerender = false;

/**
 * Audio cleanup pro Studnu.
 *
 * Synology Task Scheduler:
 *   - Denně 03:00
 *   - curl -X POST https://www.raseliniste.cz/api/cron/cleanup-audio
 *          -H "x-cron-key: <CRON_SECRET>"
 *
 * Logika:
 *   - Smaže `audioPath` soubor z disku pro recordings, kde:
 *     * type = STANDARD
 *     * isPinned = false
 *     * createdAt < now - 14 dní
 *     * audioPath != null (ještě tam je)
 *     * projekt NENÍ Prskavka (isPrivate=false) — Prskavkové audio zůstává navždy
 *     * pozvánka (projekt × host) NEMÁ keepAudio=true
 *   - Transkripty + analýza zůstávají v DB navždy
 *   - Briefy se nemažou nikdy
 *   - Prskavka (isPrivate=true): audio zůstává natrvalo, mizí jen při smazání projektu
 *   - Hosti s keepAudio=true: audio zůstává natrvalo (per-projekt nastavení)
 */

const RETENTION_DAYS = 14;

export const POST: APIRoute = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.projectRecording.findMany({
    where: {
      type: "STANDARD",
      isPinned: false,
      createdAt: { lt: cutoff },
      audioPath: { not: null },
      // Prskavka (isPrivate=true) je Petrův osobní kreativní prostor — audio
      // se nemaže automaticky, jen při smazání projektu. Cleanup se týká jen
      // sdílené Studánky (isPrivate=false).
      project: { isPrivate: false },
    },
    select: { id: true, audioPath: true, projectId: true, guestUserId: true },
  });

  // Vyfiltruj nahrávky kde pozvánka (projekt × host) má keepAudio=true.
  // Owner-recordings (guestUserId=null) cleanup zachytí normálně — keepAudio
  // je per-host nastavení, owner si pinuje přes isPinned.
  const protectedKeys = new Set<string>();
  const guestPairs = candidates
    .filter((r) => r.guestUserId)
    .map((r) => ({ projectId: r.projectId, guestUserId: r.guestUserId! }));
  if (guestPairs.length > 0) {
    const keepInvites = await prisma.projectInvitation.findMany({
      where: {
        keepAudio: true,
        OR: guestPairs.map((p) => ({ projectId: p.projectId, guestUserId: p.guestUserId })),
      },
      select: { projectId: true, guestUserId: true },
    });
    for (const inv of keepInvites) protectedKeys.add(`${inv.projectId}|${inv.guestUserId}`);
  }
  const toDelete = candidates.filter(
    (r) => !(r.guestUserId && protectedKeys.has(`${r.projectId}|${r.guestUserId}`)),
  );

  let deleted = 0;
  for (const r of toDelete) {
    await deleteUpload(r.audioPath);
    await prisma.projectRecording.update({
      where: { id: r.id },
      data: { audioPath: null },
    });
    deleted++;
  }

  return Response.json({
    ok: true,
    retentionDays: RETENTION_DAYS,
    deleted,
    scanned: candidates.length,
    protectedByKeepAudio: candidates.length - toDelete.length,
  });
};
