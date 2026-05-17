import { spawn } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

/**
 * Backup pipeline pro raseliniste.
 *
 * Petr 2026-05-17: záloha PostgreSQL DB + uploads/ na druhou Synology přes
 * Tailscale rsync.
 *
 * Kroky:
 *   1. pg_dump → /data/backups/db-YYYY-MM-DD.sql.gz
 *   2. tar.gz uploads/ → /data/backups/uploads-YYYY-MM-DD.tar.gz
 *   3. rsync na druhý NAS (BACKUP_REMOTE_HOST:BACKUP_REMOTE_PATH) přes SSH
 *   4. Lokální retention: smazat starší než BACKUP_LOCAL_RETENTION_DAYS (default 30)
 *
 * Idempotence: pokud backup s dnešním datem existuje, přepíše se (denní = max 1×).
 *
 * Env config (docker-compose.yml):
 *   BACKUP_LOCAL_PATH            /data/backups (mount volume)
 *   BACKUP_UPLOADS_PATH          /data/uploads (zdroj — UPLOADS_PATH)
 *   BACKUP_REMOTE_HOST           IP/hostname druhého NASu (Tailscale: 100.83.62.70)
 *   BACKUP_REMOTE_MODULE         rsync daemon modul (= shared folder name, např. ZALOHY_APLIKACI)
 *   BACKUP_REMOTE_PATH           subpath uvnitř modulu (např. raseliniste)
 *   BACKUP_REMOTE_USER           rsync user (z DSM File Services > rsync)
 *   BACKUP_REMOTE_PASSWORD       rsync password
 *   BACKUP_LOCAL_RETENTION_DAYS  retention lokálně, default 30
 *   BACKUP_HEALTHCHECK_URL       https://hc-ping.com/<uuid> — ping start/success/fail
 *                                pro monitoring přes healthchecks.io. Detekuje
 *                                missed pings a posílá mail/SMS Petrovi.
 *
 * Synology DSM > File Services > rsync musí být ENABLED s rsync účtem.
 * Modul = shared folder, subpath = složka uvnitř. Port 873 (default).
 *
 * Vyžaduje v containeru: pg_dump (postgresql-client), tar (busybox), rsync.
 * Viz Dockerfile.
 */

export interface BackupResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: {
    pgDump: { ok: boolean; bytes?: number; error?: string };
    uploadsTar: { ok: boolean; bytes?: number; error?: string };
    rsync: { ok: boolean; output?: string; error?: string; skipped?: boolean };
    retention: { ok: boolean; deleted?: number; error?: string };
  };
  files: { db: string; uploads: string };
}

const BACKUP_DIR = process.env.BACKUP_LOCAL_PATH ?? "/data/backups";
const UPLOADS_DIR = process.env.UPLOADS_PATH ?? "/data/uploads";
const LOCAL_RETENTION_DAYS = Number(process.env.BACKUP_LOCAL_RETENTION_DAYS ?? "30");

export async function runBackup(opts: { triggeredBy?: "cron" | "manual-session" | "manual-key" } = {}): Promise<BackupResult> {
  const startedAt = new Date();
  const stamp = ymd(startedAt);

  // Healthchecks.io start ping (best-effort, neblokuje běh)
  await pingHealthcheck("start");

  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const dbFile = path.join(BACKUP_DIR, `db-${stamp}.sql.gz`);
  const uploadsFile = path.join(BACKUP_DIR, `uploads-${stamp}.tar.gz`);

  const result: BackupResult = {
    ok: false,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    steps: {
      pgDump: { ok: false },
      uploadsTar: { ok: false },
      rsync: { ok: false },
      retention: { ok: false },
    },
    files: { db: dbFile, uploads: uploadsFile },
  };

  // Step 1: pg_dump
  try {
    const bytes = await pgDumpToFile(dbFile);
    result.steps.pgDump = { ok: true, bytes };
  } catch (e) {
    result.steps.pgDump = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Step 2: tar.gz uploads
  try {
    if (await dirExists(UPLOADS_DIR)) {
      const bytes = await tarGzDir(UPLOADS_DIR, uploadsFile);
      result.steps.uploadsTar = { ok: true, bytes };
    } else {
      result.steps.uploadsTar = { ok: false, error: `${UPLOADS_DIR} neexistuje` };
    }
  } catch (e) {
    result.steps.uploadsTar = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Step 3: rsync (jen pokud je nakonfigurované)
  const remoteHost = process.env.BACKUP_REMOTE_HOST;
  const remoteModule = process.env.BACKUP_REMOTE_MODULE;
  const remotePath = process.env.BACKUP_REMOTE_PATH ?? "";
  if (!remoteHost || !remoteModule) {
    result.steps.rsync = { ok: true, skipped: true, output: "BACKUP_REMOTE_HOST/MODULE nenastaveno — jen lokální záloha." };
  } else {
    try {
      const output = await rsyncToRemote(BACKUP_DIR, remoteHost, remoteModule, remotePath);
      result.steps.rsync = { ok: true, output: output.slice(-500) };
    } catch (e) {
      result.steps.rsync = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Step 4: retention — smaž starší než N dní lokálně
  try {
    const deleted = await pruneOldBackups(BACKUP_DIR, LOCAL_RETENTION_DAYS);
    result.steps.retention = { ok: true, deleted };
  } catch (e) {
    result.steps.retention = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const finishedAt = new Date();
  result.finishedAt = finishedAt.toISOString();
  result.durationMs = finishedAt.getTime() - startedAt.getTime();
  // Backup je OK jen pokud pg_dump i uploads prošly. Rsync skipped (pokud
  // remote nenastavený) bere se jako OK, ale fail rsync = celkový fail.
  result.ok = result.steps.pgDump.ok && result.steps.uploadsTar.ok && result.steps.rsync.ok;

  // Healthchecks.io success / fail ping (best-effort)
  const summary = buildHealthcheckSummary(result);
  await pingHealthcheck(result.ok ? "success" : "fail", summary);

  // Zápis do DB tabulky BackupRun pro admin /settings/backup-log UI
  try {
    await prisma.backupRun.create({
      data: {
        startedAt,
        finishedAt,
        durationMs: result.durationMs,
        ok: result.ok,
        triggeredBy: opts.triggeredBy ?? "cron",
        pgDumpOk: result.steps.pgDump.ok,
        pgDumpBytes: result.steps.pgDump.bytes ?? null,
        pgDumpError: result.steps.pgDump.error ?? null,
        uploadsTarOk: result.steps.uploadsTar.ok,
        uploadsTarBytes: result.steps.uploadsTar.bytes ?? null,
        uploadsTarError: result.steps.uploadsTar.error ?? null,
        rsyncOk: result.steps.rsync.ok,
        rsyncSkipped: result.steps.rsync.skipped ?? false,
        rsyncError: result.steps.rsync.error ?? null,
        retentionOk: result.steps.retention.ok,
        retentionDeleted: result.steps.retention.deleted ?? null,
        retentionError: result.steps.retention.error ?? null,
      },
    });
  } catch (e) {
    console.error("[backup] failed to log BackupRun to DB:", e instanceof Error ? e.message : e);
  }

  return result;
}

/**
 * Healthchecks.io ping. Petr nastaví BACKUP_HEALTHCHECK_URL = https://hc-ping.com/<uuid>.
 * Pošlou se 3 endpointy:
 *   - /start  na začátku (pro duration tracking)
 *   - /       po úspěchu
 *   - /fail   po chybě
 * Body obsahuje text summary co Petr uvidí v HC dashboardu.
 *
 * Best-effort: pokud ping selže (síť, timeout), neblokuje backup samotný.
 */
async function pingHealthcheck(kind: "start" | "success" | "fail", body?: string): Promise<void> {
  const baseUrl = process.env.BACKUP_HEALTHCHECK_URL;
  if (!baseUrl) return;
  const url = kind === "start" ? `${baseUrl}/start`
            : kind === "fail" ? `${baseUrl}/fail`
            : baseUrl;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    await fetch(url, {
      method: "POST",
      body: body ?? "",
      signal: controller.signal,
    }).catch((e) => { console.warn(`[backup] healthcheck ${kind} failed:`, e instanceof Error ? e.message : e); });
    clearTimeout(timeout);
  } catch (e) {
    console.warn(`[backup] healthcheck ${kind} error:`, e instanceof Error ? e.message : e);
  }
}

function buildHealthcheckSummary(r: BackupResult): string {
  const lines: string[] = [
    `Backup ${r.startedAt} → ${r.finishedAt}`,
    `Duration: ${(r.durationMs / 1000).toFixed(1)}s`,
    `Overall: ${r.ok ? "OK" : "FAIL"}`,
    ``,
    `pg_dump:   ${r.steps.pgDump.ok ? `OK (${fmtBytes(r.steps.pgDump.bytes)})` : `FAIL — ${r.steps.pgDump.error ?? ""}`}`,
    `uploads:   ${r.steps.uploadsTar.ok ? `OK (${fmtBytes(r.steps.uploadsTar.bytes)})` : `FAIL — ${r.steps.uploadsTar.error ?? ""}`}`,
    `rsync:     ${r.steps.rsync.ok ? (r.steps.rsync.skipped ? "SKIPPED (remote nenastaven)" : "OK") : `FAIL — ${r.steps.rsync.error ?? ""}`}`,
    `retention: ${r.steps.retention.ok ? `OK (smazáno ${r.steps.retention.deleted ?? 0})` : `FAIL — ${r.steps.retention.error ?? ""}`}`,
  ];
  return lines.join("\n");
}

function fmtBytes(n: number | undefined): string {
  if (n === undefined || n === null) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ymd(d: Date): string {
  // YYYY-MM-DD v Praze TZ (kontejner už běží v Europe/Prague od commit 79f8388)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * pg_dump | gzip > file. Connection string z DATABASE_URL.
 *
 * --no-owner --no-privileges = portable dump (lze restore i pod jiným userem)
 * --clean --if-exists = restore skript DROP/CREATE existing objects
 */
async function pgDumpToFile(outPath: string): Promise<number> {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL není nastaveno.");

  return new Promise((resolve, reject) => {
    const dump = spawn("pg_dump", [
      dbUrl,
      "--no-owner",
      "--no-privileges",
      "--clean",
      "--if-exists",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const gzip = spawn("gzip", ["-9"], { stdio: ["pipe", "pipe", "pipe"] });
    const out = createWriteStream(outPath);

    dump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(out);

    let dumpErr = "";
    let gzipErr = "";
    dump.stderr.on("data", (c) => { dumpErr += c.toString(); });
    gzip.stderr.on("data", (c) => { gzipErr += c.toString(); });

    let dumpClosed = false;
    let gzipClosed = false;
    let outClosed = false;
    let dumpCode: number | null = null;
    let gzipCode: number | null = null;

    function tryFinish() {
      if (dumpClosed && gzipClosed && outClosed) {
        if (dumpCode !== 0) {
          reject(new Error(`pg_dump exit ${dumpCode}: ${dumpErr.slice(-500)}`));
        } else if (gzipCode !== 0) {
          reject(new Error(`gzip exit ${gzipCode}: ${gzipErr.slice(-500)}`));
        } else {
          fs.stat(outPath).then((s) => resolve(s.size)).catch(reject);
        }
      }
    }

    dump.on("close", (code) => { dumpClosed = true; dumpCode = code; tryFinish(); });
    gzip.on("close", (code) => { gzipClosed = true; gzipCode = code; tryFinish(); });
    out.on("close", () => { outClosed = true; tryFinish(); });
    dump.on("error", reject);
    gzip.on("error", reject);
    out.on("error", reject);
  });
}

async function tarGzDir(srcDir: string, outPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const parent = path.dirname(srcDir);
    const base = path.basename(srcDir);
    const tar = spawn("tar", ["-czf", outPath, "-C", parent, base], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    tar.stderr.on("data", (c) => { stderr += c.toString(); });
    tar.on("error", reject);
    tar.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`tar exit ${code}: ${stderr.slice(-500)}`));
      } else {
        try {
          const s = await fs.stat(outPath);
          resolve(s.size);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

/**
 * Rsync daemon protocol (port 873, dvojité dvojtečky `user@host::module/path`).
 * Synology DSM > File Services > rsync. Heslo přes RSYNC_PASSWORD env.
 *
 * -avz archive+verbose+compress, --delete = remote mirror lokálního stavu
 * (po pruneOldBackups smažeme staré lokálně, rsync --delete to dělá i remote).
 */
async function rsyncToRemote(
  localDir: string,
  host: string,
  module: string,
  remoteSubpath: string,
): Promise<string> {
  const user = process.env.BACKUP_REMOTE_USER ?? "";
  const password = process.env.BACKUP_REMOTE_PASSWORD ?? "";
  if (!user || !password) {
    throw new Error("BACKUP_REMOTE_USER/PASSWORD nenastaveno.");
  }

  // Synology rsync URL: user@host::MODULE/subpath/
  // Trailing slash u zdroje = obsah složky (ne složka sama).
  const subpath = remoteSubpath.replace(/^\/+|\/+$/g, "");
  const dest = subpath
    ? `${user}@${host}::${module}/${subpath}/`
    : `${user}@${host}::${module}/`;

  const args = ["-avz", "--delete", `${localDir}/`, dest];

  return new Promise((resolve, reject) => {
    const rs = spawn("rsync", args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Heslo přes env, ne CLI (CLI by se objevilo v ps)
      env: { ...process.env, RSYNC_PASSWORD: password },
    });
    let stdout = "";
    let stderr = "";
    rs.stdout.on("data", (c) => { stdout += c.toString(); });
    rs.stderr.on("data", (c) => { stderr += c.toString(); });
    rs.on("error", reject);
    rs.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`rsync exit ${code}. Stderr: ${stderr.slice(-500)}. Stdout: ${stdout.slice(-500)}`));
      } else {
        resolve(stdout + stderr);
      }
    });
  });
}

async function pruneOldBackups(dir: string, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = await fs.readdir(dir);
  let deleted = 0;
  for (const f of files) {
    // Smaž jen naše backup soubory (db-*.sql.gz, uploads-*.tar.gz)
    if (!f.startsWith("db-") && !f.startsWith("uploads-")) continue;
    const p = path.join(dir, f);
    try {
      const s = await fs.stat(p);
      if (s.mtimeMs < cutoff) {
        await fs.unlink(p);
        deleted++;
      }
    } catch { /* ignore */ }
  }
  return deleted;
}

/** Volá se z UI/admin pro výpis existujících backupů. */
export async function listLocalBackups(): Promise<Array<{ name: string; size: number; createdAt: string }>> {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const out: Array<{ name: string; size: number; createdAt: string }> = [];
    for (const f of files) {
      if (!f.startsWith("db-") && !f.startsWith("uploads-")) continue;
      const p = path.join(BACKUP_DIR, f);
      const s = await fs.stat(p);
      out.push({ name: f, size: s.size, createdAt: s.mtime.toISOString() });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
