import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, AlertTriangle, Upload, CheckSquare, BookOpen, Lock, Eye, EyeOff } from "lucide-react";
import { useRecordingProtection, recordingProtectionTip } from "./useRecordingProtection";

const TICK_MS = 250;
const MODE_KEY = "diktat-mode";
const LIMIT_KEY = "diktat-limit-min";

const MODES = {
  TASK: {
    id: "task" as const,
    label: "Úkoly",
    Icon: CheckSquare,
    color: "var(--tint-peach)",
    description: "Salva úkolů → AI je rozdělí, ty schválíš v review.",
    endpoint: "/api/ukoly/audio",
    successPath: (id: string) => `/ukoly/audio/${id}/review`,
    limitOptions: [3, 10, 30],
    defaultLimit: 10,
  },
  JOURNAL: {
    id: "journal" as const,
    label: "Deník",
    Icon: BookOpen,
    color: "var(--tint-butter)",
    description: "Volný proud myšlenek → AI vyrobí strukturovaný zápis.",
    endpoint: "/api/denik/audio",
    successPath: (id: string) => `/denik/${id}/edit`,
    limitOptions: [5, 15, 30, 60],
    defaultLimit: 15,
  },
} as const;

type Mode = "task" | "journal";
type Phase = "idle" | "recording" | "uploading" | "redirecting" | "error";

function loadMode(): Mode {
  if (typeof window === "undefined") return "task";
  // 1) URL parametr má přednost (z dlaždic na /start)
  const urlMode = new URLSearchParams(window.location.search).get("mode");
  if (urlMode === "journal" || urlMode === "task") return urlMode;
  // 2) Jinak persistence z localStorage (předchozí volba)
  const v = window.localStorage.getItem(MODE_KEY);
  return v === "journal" ? "journal" : "task";
}

function loadLimit(mode: Mode, options: readonly number[]): number {
  if (typeof window === "undefined") return MODES[mode === "task" ? "TASK" : "JOURNAL"].defaultLimit;
  const raw = window.localStorage.getItem(`${LIMIT_KEY}-${mode}`);
  const n = raw ? parseInt(raw) : NaN;
  return options.includes(n as never) ? n : MODES[mode === "task" ? "TASK" : "JOURNAL"].defaultLimit;
}

export default function DiktatRecorder() {
  const [mode, setMode] = useState<Mode>("task");
  const cfg = mode === "task" ? MODES.TASK : MODES.JOURNAL;

  const [limitMin, setLimitMin] = useState<number>(cfg.defaultLimit);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const protection = useRecordingProtection();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const m = loadMode();
    setMode(m);
    // Pokud URL má ?upload=1, automaticky otevři file picker — Petr přišel
    // z /ukoly nebo /denik kliknutím "Nahrát soubor", chce hned zvolit soubor.
    if (typeof window !== "undefined") {
      const auto = new URLSearchParams(window.location.search).get("upload") === "1";
      if (auto) {
        // Krátký delay na hydration + render file inputu
        setTimeout(() => fileInputRef.current?.click(), 250);
      }
    }
  }, []);

  useEffect(() => {
    const newCfg = mode === "task" ? MODES.TASK : MODES.JOURNAL;
    setLimitMin(loadLimit(mode, newCfg.limitOptions));
  }, [mode]);

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  function changeMode(m: Mode) {
    if (phase !== "idle") return;
    setMode(m);
    if (typeof window !== "undefined") window.localStorage.setItem(MODE_KEY, m);
  }

  function changeLimit(min: number) {
    setLimitMin(min);
    if (typeof window !== "undefined") window.localStorage.setItem(`${LIMIT_KEY}-${mode}`, String(min));
  }

  const limitSec = limitMin * 60;

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        const finalMs = Date.now() - startedAtRef.current;
        // Protection check — varovat pokud audio nesedí na uplynulý čas
        // nebo byl tab v background
        const warning = protection.stop(blob, finalMs);
        if (warning && !confirm(`${warning}\n\nChceš přesto pokračovat a nahrát co máš?`)) {
          setPhase("idle");
          return;
        }
        await upload(blob, Math.round(finalMs / 1000));
      };

      mr.start();
      startedAtRef.current = Date.now();
      await protection.start(); // wake lock + visibility tracking
      setPhase("recording");
      setElapsedMs(0);

      tickRef.current = setInterval(() => {
        const e = Date.now() - startedAtRef.current;
        setElapsedMs(e);
        if (e >= limitSec * 1000) stopRecording();
      }, TICK_MS);
    } catch (e) {
      setPhase("error");
      setError(`Mikrofon nedostupný: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRecording() {
    if (tickRef.current) clearInterval(tickRef.current);
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
  }

  async function upload(audio: Blob, durationSec: number) {
    setPhase("uploading");
    const fd = new FormData();
    const ext = audio.type.includes("webm") ? "webm" : audio.type.includes("mp4") ? "mp4" : "audio";
    const name = mode === "task" ? "task-salva" : "denik";
    fd.append("audio", new File([audio], `${name}.${ext}`, { type: audio.type }));
    fd.append("durationSec", String(durationSec));
    if (mode === "journal") {
      // Předej dnešní datum (default v server endpointu)
      fd.append("date", new Date().toISOString().slice(0, 10));
    }

    try {
      const res = await fetch(cfg.endpoint, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setPhase("error");
        setError(data.error ?? `Server vrátil ${res.status}`);
        return;
      }
      setPhase("redirecting");
      const id = data.batchId ?? data.entryId;
      window.location.href = cfg.successPath(id);
    } catch (e) {
      setPhase("error");
      setError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function uploadFile(file: File) {
    await upload(file, 0);
  }

  const remainMs = Math.max(0, limitSec * 1000 - elapsedMs);
  const remM = Math.floor(remainMs / 60000);
  const remS = Math.floor((remainMs % 60000) / 1000).toString().padStart(2, "0");
  const elM = Math.floor(elapsedMs / 60000);
  const elS = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");
  const progressPercent = Math.min(100, (elapsedMs / (limitSec * 1000)) * 100);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="font-serif text-2xl">Ozvěna</h1>
        <p className="text-sm text-muted-foreground mt-1">{cfg.description}</p>
      </div>

      {/* Mode switcher — vždy nahoře, výrazný */}
      <div className="grid grid-cols-2 gap-2">
        {(["task", "journal"] as const).map((m) => {
          const c = m === "task" ? MODES.TASK : MODES.JOURNAL;
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => changeMode(m)}
              disabled={phase !== "idle" && phase !== "error"}
              className={`rounded-xl p-4 border-2 transition flex flex-col items-center gap-2 ${
                active
                  ? "border-current bg-white/5"
                  : "border-white/10 hover:border-white/30 opacity-60"
              }`}
              style={active ? { color: c.color } : undefined}
            >
              <c.Icon className="size-6" />
              <div className="text-base font-medium" style={active ? { color: "var(--foreground)" } : undefined}>
                {c.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="glass-strong rounded-xl p-6 text-center min-h-[280px] flex flex-col items-center justify-center gap-4">
        {phase === "idle" && (
          <>
            <button
              onClick={startRecording}
              className="size-24 rounded-full text-black grid place-items-center shadow-xl hover:scale-105 transition-transform active:scale-95"
              style={{ background: cfg.color }}
            >
              <Mic className="size-10" />
            </button>
            <div className="text-base font-medium">Tap pro záznam</div>
            <div className="flex gap-1">
              {cfg.limitOptions.map((o) => (
                <button
                  key={o}
                  onClick={() => changeLimit(o)}
                  className={`px-3 py-1 rounded text-xs font-mono ${
                    limitMin === o
                      ? "bg-foreground text-background"
                      : "bg-white/5 hover:bg-white/10 text-muted-foreground"
                  }`}
                >
                  {o} min
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground font-mono">auto-stop po {limitMin} min</div>
            <div className="text-xs text-muted-foreground/80 max-w-sm leading-relaxed">
              {recordingProtectionTip(protection.wakeLockSupported)}
            </div>
            {/* Prominentní upload card — Petr 2026-05-07: stejný flow jako mikrofon,
                ale vstup je hotový soubor (Voice Recorder, Plaud, podcast atd.) */}
            <div className="w-full max-w-sm mt-4 pt-4 border-t border-white/10">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
                style={{
                  background: "color-mix(in oklch, var(--tint-lavender) 14%, transparent)",
                  border: "1px dashed color-mix(in oklch, var(--tint-lavender) 40%, transparent)",
                  color: "color-mix(in oklch, var(--tint-lavender) 92%, white)",
                }}
              >
                <Upload className="size-4" />
                📎 Nahrát hotový audio soubor (MP3/M4A/...)
              </button>
              <a
                href="/help/upload-audio"
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-2 text-center text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Nevíš jak na to? Otevři návod →
              </a>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mp4,.flac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
                e.target.value = "";
              }}
            />
          </>
        )}

        {phase === "recording" && (
          <>
            <div className="size-24 rounded-full bg-destructive/20 grid place-items-center animate-pulse">
              <div className="size-12 rounded-full bg-destructive" />
            </div>
            <div className="font-mono text-5xl tabular-nums font-light">{remM}:{remS}</div>
            <div className="text-xs text-muted-foreground font-mono">
              zbývá · uplynulo {elM}:{elS} z {limitMin}:00
            </div>
            <div className="w-full max-w-xs h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-destructive transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            {/* Wake lock + visibility status */}
            <div className="flex items-center gap-3 text-[10px] font-mono">
              {protection.wakeLockActive ? (
                <span className="text-[var(--tint-sage)] flex items-center gap-1">
                  <Lock className="size-3" /> obrazovka uzamčena proti spánku
                </span>
              ) : protection.wakeLockSupported ? (
                <span className="text-muted-foreground/60">wake lock nedostupný</span>
              ) : null}
              {protection.hiddenDurations.length > 0 && (
                <span className="text-[var(--tint-rose)] flex items-center gap-1">
                  <EyeOff className="size-3" /> přerušeno {protection.hiddenDurations.length}×
                </span>
              )}
            </div>
            {protection.hiddenDurations.length > 0 && (
              <div className="rounded-md border border-[var(--tint-rose)]/40 bg-[var(--tint-rose)]/10 text-xs px-3 py-2 max-w-xs">
                ⚠ Přepnul jsi mimo Ozvěnu — část záznamu může chybět (iOS suspenduje appku v background).
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

        {(phase === "uploading" || phase === "redirecting") && (
          <>
            <Loader2 className="size-12 animate-spin" style={{ color: cfg.color }} />
            <div className="text-base font-medium">
              {phase === "uploading" ? "Nahrávám…" : "Otevírám…"}
            </div>
            <div className="text-xs text-muted-foreground">
              {phase === "uploading" ? "audio na server" : "AI běží na pozadí"}
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <AlertTriangle className="size-12 text-destructive" />
            <div className="text-base font-medium">Chyba</div>
            <div className="text-xs text-destructive max-w-xs">{error}</div>
            <button
              onClick={() => { setPhase("idle"); setError(null); }}
              className="mt-2 px-4 py-2 rounded-md hover:bg-white/5 text-sm"
            >
              Zkusit znovu
            </button>
          </>
        )}
      </div>

      {mode === "task" && phase === "idle" && (
        <details className="glass rounded-xl px-5 py-4 text-sm">
          <summary className="cursor-pointer font-medium">Tip pro úkoly</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>„Zítra zavolat Honzovi kvůli střeše. Do pátku poslat fakturu Wonderhood. Karel ať dohodne tu schůzku."</p>
            <p>→ AI vyrobí 3 oddělené úkoly s termíny, „Karel ať" detekuje jako delegaci.</p>
          </div>
        </details>
      )}

      {mode === "journal" && phase === "idle" && (
        <details className="glass rounded-xl px-5 py-4 text-sm">
          <summary className="cursor-pointer font-medium">Tip pro deník</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>Mluv volně, jako k sobě. „Dneska jsem byl unavený, ráno hokej se synem, večer se mi nechtělo s nikým mluvit…"</p>
            <p>→ AI to učeše do strukturovaného zápisu, zachová tvůj hlas, nepřidá vatu.</p>
          </div>
        </details>
      )}
    </div>
  );
}
