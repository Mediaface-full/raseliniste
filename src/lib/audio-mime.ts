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
 * Normalizace klientova MIME na **Gemini-supported** hodnoty.
 *
 * Petr 2026-05-14 hlasil "Studanka, chyba zpracovani: Gemini 400 INVALID_ARGUMENT".
 * Pricina: Safari iOS pro m4a soubory posila `audio/x-m4a` nebo `audio/m4a`,
 * coz Gemini neuznava — chce `audio/mp4`. Bez teto normalizace jsme klientove
 * MIME predavali doslova a Gemini ho odmitl.
 *
 * Gemini officially supported audio MIMEs (Gemini 2.5):
 *   audio/wav, audio/mp3, audio/mpeg, audio/aiff, audio/aac, audio/ogg,
 *   audio/flac, audio/mp4 (NE audio/m4a), audio/webm
 *
 * Mapovani non-standard → standard:
 */
const MIME_NORMALIZE: Record<string, string> = {
  "audio/m4a":      "audio/mp4",     // Safari iOS, některé Android
  "audio/x-m4a":    "audio/mp4",     // Safari iOS variant
  "audio/mp4a":     "audio/mp4",     // další varianta
  "audio/x-mp3":    "audio/mpeg",
  "audio/mp3":      "audio/mpeg",    // ne všechny varianty MPEG audio
  "audio/x-mpeg":   "audio/mpeg",
  "audio/x-wav":    "audio/wav",
  "audio/wave":     "audio/wav",
  "audio/x-pn-wav": "audio/wav",
  "audio/x-aac":    "audio/aac",
  "audio/x-aiff":   "audio/aiff",
  "audio/x-flac":   "audio/flac",
  "audio/vorbis":   "audio/ogg",
  "audio/x-ogg":    "audio/ogg",
};

/** MIME co Gemini přijímá. Po normalizaci kontrolujeme proti tomuto setu. */
const GEMINI_SUPPORTED: ReadonlySet<string> = new Set([
  "audio/wav",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/mp4",
  "audio/webm",
  "audio/opus",
]);

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
  // STRIP codec sufix — MediaRecorder z prohlížeče posílá `audio/webm;codecs=opus`
  // nebo `audio/mp4;codecs=mp4a`. Gemini chce čistý MIME bez codec parameter.
  // Petr 2026-05-14: host záznamy (Jan ve studánce) padaly na tomto.
  const rawMime = (clientMime || "").toLowerCase().trim();
  const mime = rawMime.split(";")[0].trim(); // "audio/webm;codecs=opus" → "audio/webm"

  // 1. Klient pošle audio/* — normalizuj na Gemini-supported variantu
  if (mime.startsWith("audio/")) {
    const normalized = MIME_NORMALIZE[mime] ?? mime;
    // Pokud po normalizaci je Gemini-supported, vrať
    if (GEMINI_SUPPORTED.has(normalized)) return normalized;
    // Jinak fall-through na extension (mozna pripona da lepsi vysledek)
  }

  // 2. Odvození z přípony (klient prazdny MIME, octet-stream, nebo non-supported audio/*)
  if (!filename) return mime.startsWith("audio/") ? mime : null;
  const lower = filename.toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx < 0) return mime.startsWith("audio/") ? mime : null;
  const ext = lower.slice(dotIdx);
  const byExt = EXT_TO_MIME[ext];
  if (byExt) return byExt;

  // 3. Fallback — klient ma audio/* ale neumime ho normalizovat, alespoň
  //    nemít null aby upload neselhal hned (Gemini pak vrátí 400 s vlastním
  //    error msg pokud netuší — ale lepší než hard 400 v naší validaci)
  return mime.startsWith("audio/") ? mime : null;
}

/**
 * Společný accept attribute pro <input type="file"> audio uploadů.
 * Kombinace MIME wildcardu + explicit extensions kvůli iPhone Files
 * appu (greyed-out files když je jen `audio/*`).
 */
export const AUDIO_ACCEPT_ATTRIBUTE =
  "audio/*,.m4a,.mp3,.wav,.ogg,.opus,.oga,.aac,.webm,.mp4,.flac,.caf,.aiff,.aif";
