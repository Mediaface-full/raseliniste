import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

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
 *   BACKUP_LOCAL_PATH         /data/backups (mount volume)
 *   BACKUP_UPLOADS_PATH       /data/uploads (zdroj — UPLOADS_PATH)
 *   BACKUP_REMOTE_HOST        hostname/IP druhého NASu v Tailscale
 *   BACKUP_REMOTE_PATH        cesta na vzdáleném NASu (např. /volume1/backups/raseliniste)
 *   BACKUP_SSH_USER           SSH uživatel druhého NASu (default: admin)
 *   BACKUP_SSH_KEY_PATH       cesta k privátnímu klíči v containeru (mount)
 *   BACKUP_LOCAL_RETENTION_DAYS  retention lokálně, default 30
 *
 * Vyžaduje v containeru: pg_dump (postgresql-client), tar (busybox), rsync,
 * ssh (openssh-client). Viz Dockerfile.
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

export async function runBackup(): Promise<BackupResult> {
  const startedAt = new Date();
  const stamp = ymd(startedAt);

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
  const remotePath = process.env.BACKUP_REMOTE_PATH;
  if (!remoteHost || !remotePath) {
    result.steps.rsync = { ok: true, skipped: true, output: "BACKUP_REMOTE_HOST/PATH nenastaveno — jen lokální záloha." };
  } else {
    try {
      const output = await rsyncToRemote(BACKUP_DIR, remoteHost, remotePath);
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

  return result;
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
    const out = require("node:fs").createWriteStream(outPath);

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

async function rsyncToRemote(localDir: string, host: string, remotePath: string): Promise<string> {
  const user = process.env.BACKUP_SSH_USER ?? "admin";
  const keyPath = process.env.BACKUP_SSH_KEY_PATH ?? "/app/.ssh/backup_id";
  const sshOpts = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "UserKnownHostsFile=/app/.ssh/known_hosts",
    "-i", keyPath,
  ];
  // -a archive, -v verbose, -z compress, --delete = remote mirror lokálního stavu
  // (po pruneOldBackups lokálně smažeme staré, --delete to udělá i remote, takže
  // remote retention = local retention. Pokud Petr chce delší remote retention,
  // odebrat --delete).
  const args = [
    "-avz",
    "--delete",
    "-e", `ssh ${sshOpts.join(" ")}`,
    `${localDir}/`,
    `${user}@${host}:${remotePath}/`,
  ];
  return new Promise((resolve, reject) => {
    const rs = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
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
