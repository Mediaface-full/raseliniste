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
 * Filter chain (verze 2, 2026-05-16 po feedbacku „hlas je tišší než předtím"):
 *   pan=mono                — slij stereo → mono (často izoluje vokál v centru)
 *   afftdn=nr=12            — FFT denoiser, redukce šumu 12 dB
 *   highpass=f=100          — odřízne basy pod 100 Hz (mužský hlas začíná ~85 Hz)
 *   loudnorm=I=-14:TP=-1.5  — EBU R128 loudness norm (Spotify standard −14 LUFS)
 *   volume=2.0              — extra +6 dB boost ať hlas vyleze
 *
 * Předchozí verze měla `lowpass=3000` (uřízla řečové formanty 3-5 kHz, zvuk
 * zněl dušený) a `dynaudnorm=p=0.95` (nezesílilo pokud nebyl headroom).
 *
 * Limitace: ffmpeg filtry nezázrakují u silné hudby v pozadí. Pokud i tohle
 * nestačí, řešením je AI source separation (Demucs/Spleeter), což chce Python
 * sidecar container nebo cloud API.
 *
 * Output: MP3 96 kbps, 16 kHz mono.
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

    // pan=mono před afftdn protože afftdn pracuje per-channel; mono zjednoduší
    // a stereo „center extraction" často izoluje vokál (hudba bývá v stranách).
    const filterChain = [
      "pan=mono|c0=0.5*c0+0.5*c1",
      "afftdn=nr=12",
      "highpass=f=100",
      "loudnorm=I=-14:TP=-1.5:LRA=11",
      "volume=2.0",
    ].join(",");

    const stderr = await runFfmpeg([
      "-y",                                           // overwrite output
      "-i", inputPath,
      "-af", filterChain,
      "-vn",                                          // bez videa (mp4 wrapper)
      "-c:a", "libmp3lame",
      "-b:a", "128k",                                 // bitrate up — řeč už ne tak ořezaná
      "-ar", "16000",                                 // 16 kHz dostatečné pro řeč
      "-ac", "1",
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
