import { prisma } from "./db";
import { transcribeAudio, type RecordingTypeStr } from "./audio-transcribe";

/**
 * Asynchronní AI zpracování nahrávky. Volá se fire-and-forget z upload
 * endpointů — uživatel dostal odpověď „uloženo", AI běží na pozadí
 * a tahle funkce updatuje řádek v DB až bude hotovo.
 *
 * NEsmí throw nahoru. Veškeré chyby se ukládají do recording.processingError.
 *
 * Známé limity (single Node proces, žádný worker queue):
 *   - Pokud kontejner restartuje uprostřed, recording zůstane v
 *     status="processing" navěky. Cleanup cron může v budoucnu zkontrolovat
 *     starší než 30 min processing rows a označit jako "error".
 */
export async function processRecording(params: {
  recordingId: string;
  audio: Buffer;
  mimeType: string;
  type: RecordingTypeStr;
  projectContext: string | null;
}): Promise<void> {
  try {
    const result = await transcribeAudio({
      audio: params.audio,
      mimeType: params.mimeType,
      recordingType: params.type,
      projectContext: params.projectContext,
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
  }
}
