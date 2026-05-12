import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, CheckCircle2, AlertTriangle, Upload, FileAudio, Lock, EyeOff } from "lucide-react";
import { useRecordingProtection, recordingProtectionTip } from "./useRecordingProtection";

interface Project {
  id: string;
  name: string;
  description: string | null;
}

type Phase = "idle" | "recording" | "uploading" | "done" | "error";
const STANDARD_LIMIT_SEC = 10 * 60;
const TICK_MS = 250;

export default function OwnerRecorder({
  ownerName,
  projects,
  onSuccess,
  compact = false,
}: {
  ownerName: string;
  projects: Project[];
  onSuccess?: () => void;
  compact?: boolean;
}) {
  // Default = poslední vybraný projekt z localStorage (pokud existuje a je v seznamu),
  // jinak první. Petr má víc projektů → nepříjemné scrollovat select pokaždé.
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const last = window.localStorage.getItem("studna-last-project-id");
      if (last && projects.some((p) => p.id === last)) return last;
    }
    return projects[0]?.id ?? "";
  });
  const selected = projects.find((p) => p.id === selectedId);

  function pickProject(id: string) {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("studna-last-project-id", id);
    }
  }
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [briefMode, setBriefMode] = useState(false);
  const [briefFile, setBriefFile] = useState<File | null>(null);
  const protection = useRecordingProtection();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const briefInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (projects.length === 0) {
    return (
      <div className="glass-strong rounded-xl p-6 text-center">
        <p className="text-sm text-muted-foreground mb-4">
          Nemáš zatím žádný projekt. Vytvoř první ve Studánce.
        </p>
        <a
          href="/studna"
          className="inline-block px-4 py-2 rounded-md bg-foreground/90 text-background text-sm font-medium"
        >
          Otevřít Studánku
        </a>
      </div>
    );
  }

  function pickMime(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const c of candidates) {
      try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {}
    }
    return "audio/webm";
  }

  async function startRecording() {
    setError(null);
    setPhase("recording");
    setElapsedMs(0);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: pickMime() });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start();
      startedAtRef.current = Date.now();
      await protection.start();
      tickRef.current = window.setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= STANDARD_LIMIT_SEC * 1000) stopRecording();
      }, TICK_MS);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function stopRecording() {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
    const stop = new Promise<void>((resolve) => { mr.onstop = () => resolve(); });
    mr.stop();
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    await stop;
    const finalMs = Date.now() - startedAtRef.current;
    const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
    const warning = protection.stop(blob, finalMs);
    if (warning && !confirm(`${warning}\n\nChceš přesto pokračovat a nahrát co máš?`)) {
      setPhase("idle");
      return;
    }
    await upload(blob, "STANDARD", Math.round(finalMs / 1000));
  }

  async function upload(audio: Blob, type: "STANDARD" | "BRIEF", durationSec: number) {
    setPhase("uploading");
    const fd = new FormData();
    fd.append("type", type);
    fd.append("durationSec", String(durationSec));
    fd.append("audio", new File([audio], "recording", { type: audio.type }));

    const res = await fetch(`/api/studna/${selectedId}/recording`, { method: "POST", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPhase("error");
      setError(data.error ?? `Server vrátil ${res.status}`);
      return;
    }
    setPhase("done");
    onSuccess?.();
    setTimeout(() => {
      setPhase("idle");
      setBriefMode(false);
      setBriefFile(null);
      setElapsedMs(0);
    }, 3000);
  }

  const remainingMs = Math.max(0, STANDARD_LIMIT_SEC * 1000 - elapsedMs);
  const remM = Math.floor(remainingMs / 60000);
  const remS = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, "0");
  const elM = Math.floor(elapsedMs / 60000);
  const elS = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");

  return (
    <div className="space-y-4">
      {projects.length > 1 && (
        <div className="glass-strong rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
              Do kterého projektu nahráváš?
            </label>
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {projects.length} projekt{projects.length === 1 ? "" : projects.length < 5 ? "y" : "ů"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {projects.map((p) => {
              const isActive = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProject(p.id)}
                  disabled={phase !== "idle"}
                  className={`text-left rounded-lg px-3 py-2.5 text-sm transition border ${
                    isActive
                      ? "bg-[var(--tint-mint)]/20 border-[var(--tint-mint)]/60 text-foreground"
                      : "bg-background/30 border-border/40 hover:bg-white/5 text-muted-foreground"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="font-medium leading-snug truncate">{p.name}</div>
                </button>
              );
            })}
          </div>
          {selected?.description && (
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{selected.description}</p>
          )}
        </div>
      )}

      <div className={`glass-strong rounded-xl text-center flex flex-col items-center justify-center gap-4 ${compact ? "p-4 min-h-[180px]" : "p-6 min-h-[280px]"}`}>
        {phase === "idle" && !briefMode && (
          <>
            <button
              onClick={startRecording}
              disabled={!selectedId}
              className={`rounded-full bg-[var(--tint-peach)] text-black grid place-items-center shadow-xl shadow-black/30 hover:scale-105 transition-transform active:scale-95 disabled:opacity-40 ${compact ? "size-16" : "size-24"}`}
            >
              <Mic className={compact ? "size-7" : "size-10"} />
            </button>
            <div className="text-base font-medium">{compact ? "Nahrát záznam" : "Tap pro záznam"}</div>
            <div className="text-xs text-muted-foreground font-mono">
              max 10 min · auto-stop · {ownerName}
            </div>
            {!compact && (
              <div className="text-xs text-muted-foreground/80 max-w-sm leading-relaxed text-center">
                {recordingProtectionTip(protection.wakeLockSupported)}
              </div>
            )}
            <button
              onClick={() => setBriefMode(true)}
              className="mt-3 text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              Klíčový brief — nahrát soubor →
            </button>
          </>
        )}

        {phase === "idle" && briefMode && (
          <>
            <FileAudio className="size-12 text-[var(--tint-mint)]" />
            <div className="text-base font-medium">Klíčový brief</div>
            {briefFile ? (
              <>
                <div className="text-sm font-mono">{briefFile.name}</div>
                <div className="text-xs text-muted-foreground">{Math.round(briefFile.size / 1024 / 1024)} MB</div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => upload(briefFile, "BRIEF", 0)}
                    className="px-4 py-2 rounded-md bg-[var(--tint-mint)] text-black text-sm font-medium"
                  >
                    Odeslat brief
                  </button>
                  <button
                    onClick={() => setBriefFile(null)}
                    className="px-3 py-2 rounded-md hover:bg-white/5 text-sm text-muted-foreground"
                  >
                    Změnit
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => briefInputRef.current?.click()}
                className="px-5 py-3 rounded-md bg-[var(--tint-mint)] text-black font-medium flex items-center gap-2"
              >
                <Upload className="size-4" /> Vybrat soubor
              </button>
            )}
            <input
              ref={briefInputRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mp4,.flac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setBriefFile(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => { setBriefMode(false); setBriefFile(null); }}
              className="mt-1 text-xs font-mono text-muted-foreground hover:text-foreground"
            >
              ← zpět na záznam
            </button>
          </>
        )}

        {phase === "recording" && (
          <>
            <div className="size-24 rounded-full bg-destructive/20 grid place-items-center animate-pulse">
              <div className="size-12 rounded-full bg-destructive" />
            </div>
            <div className="font-mono text-4xl tabular-nums">{remM}:{remS}</div>
            <div className="text-xs text-muted-foreground font-mono">uplynulo {elM}:{elS}</div>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              {protection.wakeLockActive && (
                <span className="text-[var(--tint-sage)] flex items-center gap-1">
                  <Lock className="size-3" /> obrazovka uzamčena proti spánku
                </span>
              )}
              {protection.hiddenDurations.length > 0 && (
                <span className="text-[var(--tint-rose)] flex items-center gap-1">
                  <EyeOff className="size-3" /> přerušeno {protection.hiddenDurations.length}×
                </span>
              )}
            </div>
            {protection.hiddenDurations.length > 0 && (
              <div className="rounded-md border border-[var(--tint-rose)]/40 bg-[var(--tint-rose)]/10 text-xs px-3 py-2 max-w-xs">
                ⚠ Přepnul jsi mimo Studánku — část záznamu může chybět.
              </div>
            )}
            <button
              onClick={stopRecording}
              className="mt-2 px-6 py-3 rounded-md bg-foreground/90 text-background font-medium flex items-center gap-2"
            >
              <Square className="size-4 fill-current" /> Stop
            </button>
          </>
        )}

        {phase === "uploading" && (
          <>
            <Loader2 className="size-12 animate-spin text-[var(--tint-peach)]" />
            <div className="text-base font-medium">Zpracovávám…</div>
            <div className="text-xs text-muted-foreground">AI rozbor po nahrání</div>
          </>
        )}

        {phase === "done" && (
          <>
            <CheckCircle2 className="size-16 text-[var(--tint-sage)]" />
            <div className="text-lg font-medium">Záznam uložen ✓</div>
          </>
        )}

        {phase === "error" && (
          <>
            <AlertTriangle className="size-12 text-destructive" />
            <div className="text-base font-medium">Chyba</div>
            <div className="text-xs text-destructive max-w-xs">{error}</div>
            <button
              onClick={() => { setPhase("idle"); setError(null); }}
              className="mt-2 px-4 py-2 rounded-md hover:bg-white/5 text-sm text-muted-foreground"
            >
              Zkusit znovu
            </button>
          </>
        )}
      </div>
    </div>
  );
}
