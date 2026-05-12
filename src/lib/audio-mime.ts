/**
 * Audio MIME helpery — pro upload endpointy.
 *
 * iPhone Files app (a některé Android browsery) občas pošle audio soubor
 * s prázdným nebo nesprávným `file.type` (např. `application/octet-stream`).
 * Server validace `mime.startsWith("audio/")` pak selže s 400 "Soubor není
 * audio".
 *
 * Fix: pokud klient vrátí prázdný / non-audio MIME, odvoď ho z přípony
 * souboru. Mapování pokrývá běžné audio formáty.
 *
 * Použití:
 *   const mime = resolveAudioMime(file.type, file.name);
 *   if (!mime) return 400;
 */

const EXT_TO_MIME: Record<string, string> = {
  ".m4a": "audio/mp4",       // Apple Voice Memos / Hlasové záznamy
  ".mp4": "audio/mp4",       // občas audio-only MP4 (Apple)
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".oga": "audio/ogg",
  ".aac": "audio/aac",
  ".webm": "audio/webm",     // Chrome MediaRecorder default
  ".flac": "audio/flac",
  ".caf": "audio/x-caf",     // Apple Core Audio Format
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

/**
 * Zkusí získat platný audio MIME type.
 *
 * Pořadí:
 *   1. Pokud `clientMime` začíná `audio/`, použij ho přímo (klient ví líp)
 *   2. Jinak zkus odvodit z přípony souboru (lowercase, poslední tečka)
 *   3. Vrátí `null` pokud nelze ani odvodit
 *
 * Příklady:
 *   resolveAudioMime("audio/mp4", "rec.m4a") → "audio/mp4"
 *   resolveAudioMime("", "rec.m4a") → "audio/mp4"  ← klíčový case pro iPhone
 *   resolveAudioMime("application/octet-stream", "song.mp3") → "audio/mpeg"
 *   resolveAudioMime("", "dokument.pdf") → null
 */
export function resolveAudioMime(clientMime: string | null | undefined, filename: string | null | undefined): string | null {
  const mime = (clientMime || "").toLowerCase().trim();
  if (mime.startsWith("audio/")) return mime;

  if (!filename) return null;
  const lower = filename.toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const ext = lower.slice(dotIdx);
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Společný accept attribute pro <input type="file"> audio uploadů.
 * Kombinace MIME wildcardu + explicit extensions kvůli iPhone Files
 * appu (greyed-out files když je jen `audio/*`).
 */
export const AUDIO_ACCEPT_ATTRIBUTE =
  "audio/*,.m4a,.mp3,.wav,.ogg,.opus,.oga,.aac,.webm,.mp4,.flac,.caf,.aiff,.aif";
