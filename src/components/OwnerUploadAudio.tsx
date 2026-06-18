/**
 * OwnerUploadAudio — admin upload audio souboru (UPLOAD type) ze startovní
 * stránky `/studna/nahravka`. Petr 2026-05-14: na své start stránce nevidí
 * upload, jen rekordér. Tento komponent přidává druhou cestu vedle rekordéru.
 *
 * Liší se od `UploadAudioCard` v `StudnaDetail.tsx` tím, že tam je projekt
 * předem znám (jsi v detailu projektu), tady je `projects[]` a uživatel
 * vybírá v dropdownu.
 */

import { useState, useEffect } from "react";
import { Upload, Loader2, AlertTriangle, Check } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string | null;
}

interface Props {
  projects: Project[];
}

export default function OwnerUploadAudio({ projects }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(projects[0]?.id ?? "");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Petr 2026-06-10: ukázat jméno + velikost souboru po úspěšném upload.
  const [doneFile, setDoneFile] = useState<{ name: string; size: number } | null>(null);

  // Petr 2026-05-14: ?upload=1 v URL → auto-otevři kartu (vstupní bod ze /start).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("upload") === "1") {
      setOpen(true);
    }
  }, []);

  async function uploadFile(file: File) {
    if (!selectedId) {
      setError("Vyber projekt.");
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(0);
    setDone(false);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const xhr = new XMLHttpRequest();
      const result = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error ?? `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Síťová chyba")));
        xhr.open("POST", `/api/studna/${selectedId}/upload-audio`);
        xhr.send(fd);
      });
      await result;
      setDone(true);
      setDoneFile({ name: file.name, size: file.size });
      setTimeout(() => {
        // Po úspěšném uploadu redirect na detail projektu — tam vidí processing status
        window.location.href = `/studna/${selectedId}`;
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  if (projects.length === 0) {
    return null; // žádný projekt → nic neukazujeme
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full glass rounded-xl p-4 flex items-center gap-3 text-left hover:bg-white/[0.04] transition-colors active:scale-[0.99]"
        style={{ ["--c" as string]: "var(--tint-lavender)", borderColor: "color-mix(in oklch, var(--tint-lavender) 30%, transparent)" }}
      >
        <div
          className="size-10 rounded-lg grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--tint-lavender) 20%, transparent)" }}
        >
          <Upload className="size-5 text-[var(--tint-lavender)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">Nahrát audio soubor</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            MP3 / M4A / WAV / podcast — jen přepis, bez AI analýzy
          </div>
        </div>
        <span className="text-muted-foreground text-lg shrink-0">→</span>
      </button>
    );
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="size-4 text-[var(--tint-lavender)]" />
          <span className="font-serif text-base">Nahrát audio soubor</span>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); setDone(false); }}
          className="text-muted-foreground hover:text-foreground text-xs"
          disabled={uploading}
        >
          zavřít
        </button>
      </div>

      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground tracking-wider mb-1.5 block">
          Projekt
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={uploading}
          className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Hotová nahrávka (podcast, zápis schůzky…). MP3/M4A/WAV/OGG/AAC/FLAC, max 500 MB.
        Spustí se <strong>jen přepis</strong> — žádná AI analýza.
      </p>

      <label
        className={`block w-full text-center py-4 rounded-md cursor-pointer transition-colors ${
          uploading || !selectedId ? "cursor-not-allowed opacity-60" : "hover:bg-[var(--tint-lavender)]/[0.08]"
        }`}
        style={{ border: "1px dashed color-mix(in oklch, var(--tint-lavender) 35%, transparent)" }}
      >
        <Upload className="size-5 mx-auto mb-1 text-[var(--tint-lavender)]" />
        <div className="text-sm">
          {uploading ? `Nahrávám… ${progress}%` : done ? "Hotovo — přesměrovávám…" : "Vybrat audio soubor"}
        </div>
        <input
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mp4,.flac"
          className="hidden"
          disabled={uploading || !selectedId}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {uploading && (
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-[var(--tint-lavender)] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {done && (
        <div className="rounded-lg border-2 border-[var(--tint-sage)]/50 bg-[var(--tint-sage)]/15 text-sm px-4 py-3 flex items-center gap-3 animate-in fade-in">
          <Check className="size-5 text-[var(--tint-sage)] shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-[var(--tint-sage)]">Úspěšně nahráno</div>
            {doneFile && (
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                {doneFile.name} ({(doneFile.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-0.5">Otevírám detail projektu…</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
    </div>
  );
}
