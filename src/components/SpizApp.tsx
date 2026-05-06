import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, X as XIcon, Copy, Check, Download, FileText, Clock } from "lucide-react";

interface SharedFile {
  id: string;
  token: string;
  originalName: string;
  mime: string;
  bytes: number;
  uploadedAt: string;
  expiresAt: string;
  downloadCount: number;
  lastDownloadAt: string | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysLeft(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function SpizApp() {
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const res = await fetch("/api/spiz");
    if (res.ok) {
      const data = await res.json();
      setFiles(data.files);
    }
  }

  useEffect(() => { load(); }, []);

  async function uploadFile(file: File) {
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const xhr = new XMLHttpRequest();
      const done = new Promise<{ shareUrl: string }>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error("Bad response")); }
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error ?? `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Síťová chyba")));
        xhr.open("POST", "/api/spiz/upload");
        xhr.send(fd);
      });
      const result = await done;
      // Auto-copy link do clipboardu hned po uploadu
      try {
        await navigator.clipboard.writeText(result.shareUrl);
      } catch { /* ignore — Petr to pak může copy přes tlačítko */ }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function copyLink(token: string, fileId: string) {
    const url = `${window.location.origin}/g/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(fileId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("Zkopíruj odkaz ručně:", url);
    }
  }

  async function deleteFile(id: string, name: string) {
    if (!confirm(`Smazat „${name}"? Sdílený odkaz okamžitě přestane fungovat.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/spiz/${id}`, { method: "DELETE" });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="glass-subtle rounded-xl p-5">
        <h1 className="font-serif text-2xl tracking-tight mb-2">Spíž</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Nahraj soubor, dostaneš odkaz, pošleš komukoli. Po <strong>14 dnech</strong> se soubor
          automaticky smaže a odkaz přestane fungovat.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !uploading) uploadFile(f);
        }}
        className={`glass rounded-2xl p-8 text-center transition-all ${
          dragOver ? "scale-[1.01]" : ""
        } ${uploading ? "opacity-80" : ""}`}
        style={{
          ["--c" as string]: "var(--tint-mint)",
          borderColor: dragOver
            ? "color-mix(in oklch, var(--tint-mint) 60%, transparent)"
            : "color-mix(in oklch, var(--tint-mint) 25%, transparent)",
          borderStyle: "dashed",
          background: dragOver
            ? "color-mix(in oklch, var(--tint-mint) 10%, transparent)"
            : undefined,
        }}
      >
        <Upload className="size-10 mx-auto mb-3 text-[var(--tint-mint)]" />
        <div className="font-serif text-lg mb-1">
          {uploading ? "Nahrávám…" : dragOver ? "Pusť soubor sem" : "Přetáhni soubor sem"}
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          nebo
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: "color-mix(in oklch, var(--tint-mint) 18%, transparent)",
            border: "1px solid color-mix(in oklch, var(--tint-mint) 35%, transparent)",
          }}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Vybrat z disku
        </button>

        {uploading && (
          <div className="mt-4 max-w-xs mx-auto">
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--tint-mint)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-muted-foreground mt-1">{progress}%</div>
          </div>
        )}

        <div className="text-[11px] font-mono text-muted-foreground/60 mt-4">
          max 500 MB · po nahrání se odkaz sám zkopíruje do schránky
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 text-left">
            {error}
          </div>
        )}
      </div>

      {/* List */}
      <div>
        <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2 px-1">
          Posledních 14 dní {files !== null ? `(${files.length})` : ""}
        </div>
        {files === null ? (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin inline mr-2" /> Načítám…
          </div>
        ) : files.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            Zatím nic nesdílíš.
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((f) => {
              const left = daysLeft(f.expiresAt);
              const expSoon = left <= 3;
              return (
                <div key={f.id} className="glass rounded-xl p-3 flex items-center gap-3">
                  <div
                    className="size-10 rounded-md grid place-items-center shrink-0"
                    style={{
                      background: "color-mix(in oklch, var(--tint-mint) 12%, transparent)",
                      border: "1px solid color-mix(in oklch, var(--tint-mint) 25%, transparent)",
                    }}
                  >
                    <FileText className="size-5 text-[var(--tint-mint)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <a
                        href={`/g/${f.token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline truncate"
                      >
                        {f.originalName}
                      </a>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {fmtBytes(f.bytes)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                      <span>nahráno {fmtDateTime(f.uploadedAt)}</span>
                      <span>·</span>
                      <span className={expSoon ? "text-[var(--tint-butter)]" : ""}>
                        <Clock className="size-3 inline mr-0.5" />
                        {left} {left === 1 ? "den" : left < 5 ? "dny" : "dní"} do smazání
                      </span>
                      {f.downloadCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{f.downloadCount}× staženo</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyLink(f.token, f.id)}
                    className="p-2 rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground"
                    title="Zkopírovat odkaz"
                  >
                    {copiedId === f.id
                      ? <Check className="size-4 text-[var(--tint-sage)]" />
                      : <Copy className="size-4" />}
                  </button>
                  <a
                    href={`/api/spiz/d/${f.token}`}
                    className="p-2 rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground"
                    title="Stáhnout"
                  >
                    <Download className="size-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteFile(f.id, f.originalName)}
                    disabled={busyId === f.id}
                    className="p-2 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                    title="Smazat hned"
                  >
                    {busyId === f.id ? <Loader2 className="size-4 animate-spin" /> : <XIcon className="size-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
