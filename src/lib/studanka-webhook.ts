import crypto from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Petr 2026-07-06: push přepisů do externího systému (SRO Manager).
 *
 * Po dokončení Stage 1 přepisu (processRecording / processRecordingFromText /
 * processUploadAudio) se zavolá notifyExternalSystem(recordingId). Pokud má
 * projekt vyplněný webhookUrl, POSTne se JSON payload s přepisem.
 *
 * Auth: HMAC-SHA256 podpis raw body přes projectBox.webhookSecret,
 * v hlavičce `X-Raseliniste-Signature: sha256=<hex>`. Externí systém si
 * podpis přepočítá a odmítne cokoliv co nesedí.
 *
 * Retry: 3 pokusy s backoffem 2 s / 10 s. Fire-and-forget — selhání
 * webhooky NIKDY nesmí shodit processing pipeline (jen console.error).
 *
 * Module-level Set drží Promise reference proti GC (stejný pattern jako
 * fire-and-forget AI ve Studně — viz memory todo_studna_async_still_failing).
 */

const inFlight = new Set<Promise<void>>();

export interface StudankaWebhookPayload {
  event: "recording.processed";
  projectId: string;
  projectName: string;
  /** Párovací klíč — ID/slug klienta v externím systému (SRO Manager). */
  clientRef: string | null;
  recordingId: string;
  recordingType: string; // STANDARD | BRIEF | UPLOAD
  guestName: string | null;
  durationSec: number | null;
  transcript: string;
  /** AI shrnutí ze Stage 2, pokud existuje (STANDARD/BRIEF mají, UPLOAD ne). */
  summary: string | null;
  createdAt: string; // ISO 8601
  processedAt: string; // ISO 8601 (teď)
}

export function signPayload(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Fire-and-forget entrypoint. Volat po status="processed" update.
 * Nikdy nevyhazuje — chyby jen loguje.
 */
export function notifyExternalSystem(recordingId: string): void {
  const p = deliverWithRetry(recordingId)
    .catch((e) => {
      console.error(
        `[studanka-webhook] delivery failed for ${recordingId}:`,
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      inFlight.delete(p);
    });
  inFlight.add(p);
}

async function deliverWithRetry(recordingId: string): Promise<void> {
  const rec = await prisma.projectRecording.findUnique({
    where: { id: recordingId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          webhookUrl: true,
          webhookSecret: true,
          externalClientRef: true,
        },
      },
      guestUser: { select: { name: true } },
    },
  });

  if (!rec) return;
  const { project } = rec;
  if (!project.webhookUrl) return; // projekt nemá integraci — nic nedělat
  if (!rec.transcript) return; // bez přepisu není co posílat

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = rec.analysis as any;
  const summary: string | null =
    typeof analysis?.summary === "string" && analysis.summary.trim()
      ? analysis.summary
      : null;

  const payload: StudankaWebhookPayload = {
    event: "recording.processed",
    projectId: project.id,
    projectName: project.name,
    clientRef: project.externalClientRef ?? null,
    recordingId: rec.id,
    recordingType: rec.type,
    guestName: rec.guestUser?.name ?? null,
    durationSec: rec.audioDurationSec ?? null,
    transcript: rec.transcript,
    summary,
    createdAt: rec.createdAt.toISOString(),
    processedAt: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Raseliniste-Studanka-Webhook/1.0",
  };
  if (project.webhookSecret) {
    headers["x-raseliniste-signature"] = signPayload(body, project.webhookSecret);
  }

  const delays = [0, 2_000, 10_000];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(project.webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        console.log(
          `[studanka-webhook] ${recordingId} → ${project.webhookUrl} OK (${res.status}, attempt ${attempt + 1})`,
        );
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
      console.warn(
        `[studanka-webhook] ${recordingId} attempt ${attempt + 1} failed: HTTP ${res.status}`,
      );
    } catch (e) {
      lastError = e;
      console.warn(
        `[studanka-webhook] ${recordingId} attempt ${attempt + 1} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
