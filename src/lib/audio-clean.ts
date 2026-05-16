import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Audio cleanup pipeline pro Studna záznamy s hudbou/šumem v pozadí.
 *
 * Petr 2026-05-16: Gemini neumí přepsat audio kde je v pozadí hudba (i tichá).
 * Tenhle filtr odřízne basy + výšky (hudba) a normalizuje hlas, takže Gemini
 * dostane čistší řeč.
 *
 * Filter chain:
 *   highpass=f=200       — uřízne pod 200 Hz (basy, kopáky)
 *   lowpass=f=3000       — uřízne nad 3 kHz (cinky, perkuse). Řeč je 300-3400 Hz.
 *   dynaudnorm=p=0.95    — dynamická normalizace: zesílí tichá místa (hlas),
 *                          stlačí hlasitá (refrény, údery)
 *
 * Output: MP3 96 kbps (kompromis mezi velikostí a kvalitou pro Gemini).
 *
 * Requires `ffmpeg` v PATH (instalováno v Dockerfile runner stage).
 */
export interface CleanAudioResult {
  cleanedBuffer: Buffer;
  mimeType: "audio/mpeg"; // vždy MP3 výstup
  filename: string;
  originalBytes: number;
  cleanedBytes: number;
  ffmpegStderr: string;
}

export async function cleanAudioForTranscription(
  inputBuffer: Buffer,
  inputMime: string,
): Promise<CleanAudioResult> {
  // Pracujeme přes temp soubory — ffmpeg na pipe občas dělá problémy s mp4/m4a
  // (potřebuje seek). Disk je v Synology kontejneru rychlý, overhead minimální.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "studna-clean-"));
  const inputExt = mimeToExt(inputMime);
  const inputPath = path.join(tmpDir, `input.${inputExt}`);
  const outputPath = path.join(tmpDir, "output.mp3");

  try {
    await fs.writeFile(inputPath, inputBuffer);

    const stderr = await runFfmpeg([
      "-y",                                           // overwrite output
      "-i", inputPath,
      "-af", "highpass=f=200,lowpass=f=3000,dynaudnorm=p=0.95",
      "-vn",                                          // bez videa (mp4 wrapper)
      "-c:a", "libmp3lame",
      "-b:a", "96k",
      "-ar", "16000",                                 // 16 kHz dostatečné pro řeč
      "-ac", "1",                                     // mono (Gemini si poradí)
      outputPath,
    ]);

    const cleanedBuffer = await fs.readFile(outputPath);
    return {
      cleanedBuffer,
      mimeType: "audio/mpeg",
      filename: "cleaned.mp3",
      originalBytes: inputBuffer.byteLength,
      cleanedBytes: cleanedBuffer.byteLength,
      ffmpegStderr: stderr.slice(-2000), // poslední 2 KB log pro debug
    };
  } finally {
    // Cleanup temp soubory (best-effort)
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("opus")) return "opus";
  if (m.includes("aac")) return "aac";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "audio";
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ffmpeg není v PATH. V Docker image musí být `apk add ffmpeg`."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg skončil s kódem ${code}. Stderr (poslední 1 KB): ${stderr.slice(-1000)}`));
    });
  });
}
