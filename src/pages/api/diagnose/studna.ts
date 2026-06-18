import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { env } from "@/lib/env";
import { getGeminiMode } from "@/lib/gemini";
import { uploadExists } from "@/lib/uploads";
import { getInFlightStudnaSnapshot } from "@/lib/process-recording";
import { getInFlightTaskAudioSnapshot } from "@/lib/process-task-audio";

export const prerender = false;

/**
 * GET /api/diagnose/studna
 *
 * Komplexní diagnostika audio pipeline (Studna + Úkoly diktát).
 * Vrátí JSON co lze poslat k debug — bez toho aby Petr musel SSH.
 *
 * Co tam je:
 *  - Aktuálně in-flight processings v Node procesu (= Promise drží)
 *  - Posledních 10 ProjectRecording per status + processingError
 *  - Posledních 10 TaskAudioBatch per status + processingError
 *  - AI usage logs za posledních 24 h: success rate, error breakdown
 *  - Env health (jen flagy true/false, žádné citlivé hodnoty)
 *  - Audio file na disku check pro stuck recordings
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. In-flight (z paměti Node procesu)
  const inFlightStudna = getInFlightStudnaSnapshot();
  const inFlightTasks = getInFlightTaskAudioSnapshot();

  // 2. Studna recordings za 24h, agregace per status
  const studnaRecordings = await prisma.projectRecording.findMany({
    where: { createdAt: { gte: since24h } },
    select: {
      id: true, type: true, status: true, processingError: true,
      audioPath: true, audioBytes: true, audioMime: true,
      createdAt: true, project: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const studnaByStatus = await prisma.projectRecording.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since24h } },
    _count: true,
  });

  // Pro stuck recordings ověř existenci audio souboru na disku
  const stuckStudna = studnaRecordings.filter((r) => r.status === "processing");
  const stuckAudioCheck = await Promise.all(
    stuckStudna.map(async (r) => ({
      id: r.id,
      audioPath: r.audioPath,
      audioOnDisk: r.audioPath ? await uploadExists(r.audioPath) : false,
      ageMin: Math.round((Date.now() - r.createdAt.getTime()) / 60000),
    })),
  );

  // 3. Task audio batches za 24h
  const taskBatches = await prisma.taskAudioBatch.findMany({
    where: { createdAt: { gte: since24h } },
    select: {
      id: true, status: true, processingError: true,
      audioPath: true, audioBytes: true, audioDurationSec: true,
      rawTranscript: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const taskByStatus = await prisma.taskAudioBatch.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since24h } },
    _count: true,
  });

  // 4. AI usage za 24h
  const aiLogs = await prisma.aiUsageLog.findMany({
    where: { at: { gte: since24h } },
    orderBy: { at: "desc" },
    take: 50,
  });
  const aiSummary = {
    total: aiLogs.length,
    success: aiLogs.filter((l) => l.success).length,
    errors: aiLogs.filter((l) => !l.success).length,
    audioStage1Errors: aiLogs.filter((l) => l.module === "audio-stage1-transcribe" && !l.success).length,
    audioStage2Errors: aiLogs.filter((l) => l.module === "audio-stage2-analyze" && !l.success).length,
    recentErrors: aiLogs
      .filter((l) => !l.success)
      .slice(0, 10)
      .map((l) => ({ at: l.at, module: l.module, model: l.model, error: l.errorMsg?.slice(0, 200) })),
  };

  // 5. Env health (jen presence flagy, ne hodnoty!)
  const envHealth = {
    geminiMode: getGeminiMode(),
    vertexProject: Boolean(env.VERTEX_PROJECT),
    vertexLocation: env.VERTEX_LOCATION ?? null,
    googleAppCredsPath: env.GOOGLE_APPLICATION_CREDENTIALS ?? null,
    geminiApiKeyPresent: Boolean(env.GEMINI_API_KEY),
    geminiApiKeyLength: env.GEMINI_API_KEY?.length ?? 0,
    cronSecretPresent: Boolean(env.CRON_SECRET),
  };

  // 6. Diagnostické závěry — auto-vyhodnocení
  const conclusions: string[] = [];

  if (envHealth.geminiMode === "vertex" && !envHealth.geminiApiKeyPresent) {
    conclusions.push(
      "⚠ Vertex AI mode bez GEMINI_API_KEY fallback. Audio >14 MB selže (Vertex Files API neexistuje).",
    );
  }
  if (envHealth.geminiMode === "unconfigured") {
    conclusions.push("AI klient není nakonfigurovaný — žádné Vertex ani API klíč.");
  }

  for (const r of stuckAudioCheck) {
    if (r.ageMin > 10 && !r.audioOnDisk) {
      conclusions.push(`Recording ${r.id} stuck ${r.ageMin} min v processing, audio na disku CHYBÍ — auto-retry cron nemůže pomoct.`);
    } else if (r.ageMin > 10 && r.audioOnDisk) {
      conclusions.push(`Recording ${r.id} stuck ${r.ageMin} min v processing, audio na disku JE — auto-retry cron by měl chytnout.`);
    } else if (r.ageMin <= 10) {
      conclusions.push(`ℹ Recording ${r.id} v processing ${r.ageMin} min — normální.`);
    }
  }

  if (inFlightStudna.length === 0 && stuckStudna.length > 0) {
    conclusions.push(
      `${stuckStudna.length} Studna recordings v "processing", ale žádný není v in-flight Set Node procesu = Promise umřela. Po deployi by inFlight Set měl držet aktivní AI runs.`,
    );
  }

  if (aiSummary.audioStage1Errors > 0 || aiSummary.audioStage2Errors > 0) {
    conclusions.push(
      `⚠ Audio Stage 1/2 errors za 24h: ${aiSummary.audioStage1Errors}/${aiSummary.audioStage2Errors}. Detail viz recentErrors.`,
    );
  }

  if (conclusions.length === 0) {
    conclusions.push("Žádné akutní problémy detekované.");
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    envHealth,
    inFlightStudna,
    inFlightTasks,
    studna: {
      countByStatus: Object.fromEntries(studnaByStatus.map((s) => [s.status, s._count])),
      recordings: studnaRecordings,
      stuckAudioCheck,
    },
    tasks: {
      countByStatus: Object.fromEntries(taskByStatus.map((s) => [s.status, s._count])),
      batches: taskBatches.map((b) => ({
        ...b,
        rawTranscriptLength: b.rawTranscript?.length ?? 0,
        rawTranscript: undefined, // skryj plný přepis (může být dlouhý)
      })),
    },
    aiUsage24h: aiSummary,
    conclusions,
  });
};
