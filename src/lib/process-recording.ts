import { prisma } from "./db";
import { transcribeAudio, analyzeTranscript, transcribeAudioOnly, type RecordingTypeStr } from "./audio-transcribe";

/**
 * Asynchronní AI zpracování nahrávky. Volá se fire-and-forget z upload
 * endpointů — uživatel dostal odpověď „uloženo", AI běží na pozadí
 * a tahle funkce updatuje řádek v DB až bude hotovo.
 *
 * KRITICKÉ: držíme silnou referenci v module-level Setu, jinak by Node
 * mohl Promise garbage-collectnout (Astro request handler skončí dřív
 * než AI doběhne). Fire-and-forget v Astro/Node bez explicitního pinu
 * nefunguje spolehlivě — to byl pravděpodobný root cause selhávání
 * Studny po commit 7e7a033.
 *
 * NEsmí throw nahoru. Veškeré chyby se ukládají do recording.processingError.
 */

interface InFlight {
  recordingId: string;
  type: RecordingTypeStr;
  startedAt: number;
  promise: Promise<void>;
}

// Module-level reference holder. Drží se tu, dokud AI neproběhne.
const inFlight = new Set<InFlight>();

/** Diagnostika — kolik je teď v paměti rozdělaných processings (pro debug endpoint). */
export function getInFlightStudnaSnapshot(): Array<{ recordingId: string; type: string; ageMs: number }> {
  const now = Date.now();
  return Array.from(inFlight).map((f) => ({
    recordingId: f.recordingId,
    type: f.type,
    ageMs: now - f.startedAt,
  }));
}

export async function processRecording(params: {
  recordingId: string;
  audio: Buffer;
  mimeType: string;
  type: RecordingTypeStr;
  projectContext: string | null;
  customStandardPrompt?: string | null;
  customBriefPrompt?: string | null;
  analysisModel?: string | null;
}): Promise<void> {
  // Zabal celé processing do jedné awaited Promise + drž referenci.
  const entry: InFlight = {
    recordingId: params.recordingId,
    type: params.type,
    startedAt: Date.now(),
    // Reálnou Promise nastavíme za chvíli (kvůli kruhové referenci)
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    try {
      console.log(`[process-recording] ${params.recordingId} start (${params.type}, ${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      const result = await transcribeAudio({
        audio: params.audio,
        mimeType: params.mimeType,
        recordingType: params.type,
        projectContext: params.projectContext,
        // Studna nahrávky čistíme od výplňových slov (ehm, eee, no, jakože, ...)
        // a zbytečných repetic. Obsah a tón zůstávají. Petr má v Studně tisíce
        // znaků přepisu — čitelnost > doslovnost.
        cleanupFillers: true,
        customStandardPrompt: params.customStandardPrompt ?? null,
        customBriefPrompt: params.customBriefPrompt ?? null,
        analysisModelOverride: params.analysisModel ?? null,
      });

      await prisma.projectRecording.update({
        where: { id: params.recordingId },
        data: {
          transcript: result.transcript,
          analysis: result.analysis as unknown as object,
          status: "processed",
          processingError: null,
        },
      });
      console.log(`[process-recording] ${params.recordingId} processed OK in ${Date.now() - entry.startedAt}ms`);

      // RAG indexace (fire-and-forget, vlastní pinning v rag.ts)
      try {
        const { indexEntity } = await import("./rag");
        const rec = await prisma.projectRecording.findUnique({
          where: { id: params.recordingId },
          select: { project: { select: { userId: true } } },
        });
        if (rec?.project.userId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summary = (result.analysis as any)?.summary ?? "";
          const indexText = [result.transcript, summary].filter(Boolean).join("\n\n");
          if (indexText.trim()) {
            void indexEntity({
              userId: rec.project.userId,
              sourceType: "studna",
              sourceId: params.recordingId,
              text: indexText,
            });
          }
        }
      } catch (ragErr) {
        console.warn(`[process-recording] RAG index skip:`, ragErr instanceof Error ? ragErr.message : ragErr);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[process-recording] ${params.recordingId} failed:`, msg);
      try {
        await prisma.projectRecording.update({
          where: { id: params.recordingId },
          data: {
            status: "error",
            processingError: msg.slice(0, 1000),
          },
        });
      } catch (updateErr) {
        console.error(`[process-recording] couldn't even update DB:`, updateErr);
      }
    } finally {
      // Uvolnit referenci — GC může Promise sebrat
      inFlight.delete(entry);
    }
  })();

  inFlight.add(entry);
  return entry.promise;
}

/**
 * Asynchronní AI zpracování textového vstupu (admin vložil hotový přepis,
 * např. zápis schůzky). Přeskočí Stage 1 (audio přepis) a spustí jen
 * Stage 2 (strukturovanou analýzu).
 */
export async function processRecordingFromText(params: {
  recordingId: string;
  transcript: string;
  type: RecordingTypeStr;
  projectContext: string | null;
  customStandardPrompt?: string | null;
  customBriefPrompt?: string | null;
  analysisModel?: string | null;
}): Promise<void> {
  const entry: InFlight = {
    recordingId: params.recordingId,
    type: params.type,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    try {
      console.log(`[process-recording-text] ${params.recordingId} start (${params.type}, ${params.transcript.length} znaků)`);
      const result = await analyzeTranscript({
        transcript: params.transcript,
        recordingType: params.type,
        projectContext: params.projectContext,
        customStandardPrompt: params.customStandardPrompt ?? null,
        customBriefPrompt: params.customBriefPrompt ?? null,
        analysisModelOverride: params.analysisModel ?? null,
      });

      await prisma.projectRecording.update({
        where: { id: params.recordingId },
        data: {
          transcript: result.transcript,
          analysis: result.analysis as unknown as object,
          status: "processed",
          processingError: null,
        },
      });
      console.log(`[process-recording-text] ${params.recordingId} processed OK in ${Date.now() - entry.startedAt}ms`);

      // RAG indexace
      try {
        const { indexEntity } = await import("./rag");
        const rec = await prisma.projectRecording.findUnique({
          where: { id: params.recordingId },
          select: { project: { select: { userId: true } } },
        });
        if (rec?.project.userId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const summary = (result.analysis as any)?.summary ?? "";
          const indexText = [result.transcript, summary].filter(Boolean).join("\n\n");
          if (indexText.trim()) {
            void indexEntity({
              userId: rec.project.userId,
              sourceType: "studna",
              sourceId: params.recordingId,
              text: indexText,
            });
          }
        }
      } catch (ragErr) {
        console.warn(`[process-recording-text] RAG index skip:`, ragErr instanceof Error ? ragErr.message : ragErr);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[process-recording-text] ${params.recordingId} failed:`, msg);
      try {
        await prisma.projectRecording.update({
          where: { id: params.recordingId },
          data: {
            status: "error",
            processingError: msg.slice(0, 1000),
          },
        });
      } catch (updateErr) {
        console.error(`[process-recording-text] couldn't even update DB:`, updateErr);
      }
    } finally {
      inFlight.delete(entry);
    }
  })();

  inFlight.add(entry);
  return entry.promise;
}

/**
 * Asynchronní AI zpracování UPLOAD audio recordings — pouze přepis,
 * žádná Stage 2 strukturovaná analýza. Audio + přepis se uchovávají natrvalo.
 */
export async function processUploadAudio(params: {
  recordingId: string;
  audio: Buffer;
  mimeType: string;
  projectContext: string | null;
}): Promise<void> {
  const entry: InFlight = {
    recordingId: params.recordingId,
    type: "STANDARD", // diagnostic snapshot field — UPLOAD nemá vlastní typ v interfaceu
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    try {
      console.log(`[process-upload-audio] ${params.recordingId} start (${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      const result = await transcribeAudioOnly({
        audio: params.audio,
        mimeType: params.mimeType,
        projectContext: params.projectContext,
      });

      await prisma.projectRecording.update({
        where: { id: params.recordingId },
        data: {
          transcript: result.transcript,
          analysis: undefined, // žádná Stage 2 — necháme null/undefined
          status: "processed",
          processingError: null,
        },
      });
      console.log(`[process-upload-audio] ${params.recordingId} processed OK in ${Date.now() - entry.startedAt}ms`);

      // RAG indexace — i UPLOAD recordings se hodí mít searchable
      try {
        const { indexEntity } = await import("./rag");
        const rec = await prisma.projectRecording.findUnique({
          where: { id: params.recordingId },
          select: { project: { select: { userId: true } } },
        });
        if (rec?.project.userId && result.transcript.trim()) {
          void indexEntity({
            userId: rec.project.userId,
            sourceType: "studna",
            sourceId: params.recordingId,
            text: result.transcript,
          });
        }
      } catch (ragErr) {
        console.warn(`[process-upload-audio] RAG index skip:`, ragErr instanceof Error ? ragErr.message : ragErr);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[process-upload-audio] ${params.recordingId} failed:`, msg);
      try {
        await prisma.projectRecording.update({
          where: { id: params.recordingId },
          data: { status: "error", processingError: msg.slice(0, 1000) },
        });
      } catch {}
    } finally {
      inFlight.delete(entry);
    }
  })();

  inFlight.add(entry);
  return entry.promise;
}
