import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Disk persistence pro uploady (loga odesílatelů, skeny podpisů,
 * vygenerovaná PDF dopisů).
 *
 * Cesta:
 *   - dev:  ./uploads/                          (gitignored)
 *   - prod: /app/uploads/  (mount z NAS:        /volume1/docker/raseliniste/uploads/)
 *
 * V DB ukládáme jen **relativní** cestu (typu "letter-senders/abc.png"),
 * full path skládáme až za běhu přes resolveUpload().
 */

// Sjednoceno s docker-compose.yml — používá konvenci UPLOADS_PATH (volume mount).
const UPLOADS_DIR =
  process.env.UPLOADS_PATH ??
  process.env.UPLOADS_DIR ??
  (process.env.NODE_ENV === "production" ? "/data/uploads" : "./uploads");

export async function ensureUploadDir(subdir: string): Promise<string> {
  const full = path.join(UPLOADS_DIR, subdir);
  await fs.mkdir(full, { recursive: true });
  return full;
}

/**
 * Bezpečné rozšíření z mime typu (whitelist — žádný .exe).
 * Tolerantní k codec parametrům: "audio/webm; codecs=opus" → "audio/webm"
 */
function extFromMime(mime: string): string | null {
  // Strip parametry (codecs=opus, charset=, …)
  const base = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "application/pdf": "pdf",
    // Audio (Studna)
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/aac": "aac",
    "audio/flac": "flac",
    // Office dokumenty + texty (project files)
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/plain": "txt",
    "text/csv": "csv",
    "text/markdown": "md",
    "application/json": "json",
    "application/rtf": "rtf",
    // Archivy
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/x-7z-compressed": "7z",
    "application/x-rar-compressed": "rar",
    "application/x-tar": "tar",
    "application/gzip": "gz",
  };
  return map[base] ?? null;
}

/**
 * Uloží binární data na disk pod náhodným jménem v daném podadresáři.
 * Vrací **relativní** cestu, kterou ulož do DB.
 */
export async function saveUpload(
  subdir: string,
  data: Buffer,
  mime: string,
): Promise<{ relativePath: string; absolutePath: string; bytes: number }> {
  const ext = extFromMime(mime);
  if (!ext) throw new Error(`Nepodporovaný typ souboru: ${mime}`);

  // Petr 2026-05-14: detekované 0-byte audio recordy v DB (Janova
  // 46s nahrávka). Prevence — odmítnout uložit prázdný buffer rovnou
  // zdola. Pokud klient pošle 0-byte blob (MediaRecorder selhal, uživatel
  // zavřel okno před save), DB row se nevytvoří se selháním later.
  if (data.byteLength === 0) {
    throw new Error("Soubor je prázdný (0 bytes). Nahrávku se nepodařilo zachytit, zkus znovu.");
  }
  // < 256 B taky podezřele krátké (audio header sám má pár stovek B)
  if (mime.startsWith("audio/") && data.byteLength < 256) {
    throw new Error(`Audio je podezřele krátké (${data.byteLength} B). Nahrávka se přerušila hned na začátku, zkus znovu.`);
  }

  await ensureUploadDir(subdir);

  const filename = `${randomBytes(12).toString("hex")}.${ext}`;
  const relativePath = path.posix.join(subdir, filename);
  const absolutePath = path.join(UPLOADS_DIR, subdir, filename);

  await fs.writeFile(absolutePath, data, { mode: 0o600 });

  return { relativePath, absolutePath, bytes: data.byteLength };
}

/**
 * Specializovaný uploader pro project files (Studánka/Prskavka přílohy).
 * Tolerantnější než saveUpload — pokud mime není v whitelistu nebo je generic,
 * fallback na příponu z originálního filename. Drobnější bezpečnostní kontrola
 * na blacklist nebezpečných extenzí.
 */
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "pif", "scr", "vbs", "js", "ws", "wsf",
  "msi", "msp", "hta", "cpl", "jar", "dll", "sys", "drv", "ps1", "psm1",
  "sh", "bash", "command", "app",
]);

export async function saveProjectFile(
  subdir: string,
  data: Buffer,
  mime: string,
  originalName: string,
): Promise<{ relativePath: string; absolutePath: string; bytes: number; safeExt: string }> {
  // Zkus získat ext z mime, fallback na originální filename
  let ext = extFromMime(mime);
  if (!ext) {
    const m = originalName.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    ext = m ? m[1] : "bin";
  }
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    throw new Error(`Tento typ souboru není povolený (${ext}).`);
  }

  await ensureUploadDir(subdir);
  const filename = `${randomBytes(12).toString("hex")}.${ext}`;
  const relativePath = path.posix.join(subdir, filename);
  const absolutePath = path.join(UPLOADS_DIR, subdir, filename);
  await fs.writeFile(absolutePath, data, { mode: 0o600 });

  return { relativePath, absolutePath, bytes: data.byteLength, safeExt: ext };
}

/**
 * Smaž soubor podle relativní cesty (ignoruje "neexistuje").
 */
export async function deleteUpload(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  const full = path.join(UPLOADS_DIR, relativePath);
  await fs.unlink(full).catch(() => null);
}

export function resolveUpload(relativePath: string): string {
  return path.join(UPLOADS_DIR, relativePath);
}

export async function readUpload(relativePath: string): Promise<Buffer> {
  return fs.readFile(resolveUpload(relativePath));
}

export async function uploadExists(relativePath: string | null | undefined): Promise<boolean> {
  if (!relativePath) return false;
  try {
    await fs.access(resolveUpload(relativePath));
    return true;
  } catch {
    return false;
  }
}
