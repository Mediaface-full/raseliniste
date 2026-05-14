/**
 * POST /api/studna/recordings/fix-mimes-and-retry
 *
 * Petr 2026-05-14: nahravky ve status=error s INVALID_ARGUMENT od Gemini
 * vznikly pred commitem 5340584 (MIME normalizace). V DB maji audio/x-m4a
 * nebo podobne non-standard MIME, Gemini je odmita. Retry je odsouzeny
 * selhat dokud MIME nezmenime.
 *
 * Tento endpoint:
 *  1. Najde vsechny ProjectRecording where status=error AND audio existuje
 *  2. Re-normalize audioMime pres resolveAudioMime (audio/x-m4a -> audio/mp4)
 *  3. Update DB pokud zmena
 *  4. Spusti regenerate (processRecording / processUploadAudio) fire-and-forget
 *
 * Bezpecnost: jen vlastni nahravky (userId session check).
 * Idempotent: nahravky uz s normalizovanym MIME pojedou jen retry.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { readUpload, uploadExists } from "@/lib/uploads";
import { processRecording, processUploadAudio } from "@/lib/process-recording";
import { resolveAudioMime } from "@/lib/audio-mime";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const errored = await prisma.projectRecording.findMany({
    where: {
      status: "error",
      project: { userId: session.uid },
      audioPath: { not: null },
    },
    include: {
      project: {
        select: { description: true, studnaStandardPrompt: true, studnaBriefPrompt: true, analysisModel: true },
      },
    },
  });

  let mimeFixed = 0;
  let retried = 0;
  let skipped = 0;
  const details: Array<{ id: string; oldMime: string | null; newMime: string; retry: boolean }> = [];

  for (const r of errored) {
    if (!r.audioPath || !(await uploadExists(r.audioPath))) {
      skipped++;
      continue;
    }
    const normalized = resolveAudioMime(r.audioMime, r.uploadedFilename ?? r.audioPath) ?? r.audioMime ?? "audio/webm";
    const mimeChanged = normalized !== r.audioMime;
    if (mimeChanged) {
      await prisma.projectRecording.update({
        where: { id: r.id },
        data: { audioMime: normalized, status: "processing", processingError: null },
      });
      mimeFixed++;
    } else {
      await prisma.projectRecording.update({
        where: { id: r.id },
        data: { status: "processing", processingError: null },
      });
    }

    let audio: Buffer;
    try {
      audio = await readUpload(r.audioPath);
    } catch {
      skipped++;
      continue;
    }

    if (r.type === "UPLOAD") {
      void processUploadAudio({
        recordingId: r.id,
        audio,
        mimeType: normalized,
        projectContext: r.project.description,
      });
    } else {
      void processRecording({
        recordingId: r.id,
        audio,
        mimeType: normalized,
        type: r.type as "STANDARD" | "BRIEF",
        projectContext: r.project.description,
        customStandardPrompt: r.project.studnaStandardPrompt,
        customBriefPrompt: r.project.studnaBriefPrompt,
        analysisModel: r.project.analysisModel,
      });
    }
    retried++;
    details.push({ id: r.id, oldMime: r.audioMime, newMime: normalized, retry: true });
  }

  return Response.json({
    ok: true,
    total: errored.length,
    mimeFixed,
    retried,
    skipped,
    details: details.slice(0, 20),
  });
};
