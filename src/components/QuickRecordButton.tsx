import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, AlertTriangle, CheckSquare, BookOpen } from "lucide-react";

/**
 * Petr 2026-06-19: dashboard kompakt rekorder.
 *
 * Klik → start record. Klik znova → stop + upload na pozadí.
 * Běžící timer + progress ring uvnitř tlačítka. Žádný redirect, žádný
 * mode switch — komponenta má pevný mode (task / journal) per instance.
 *
 * Žádný redirect po uploadu (fire-and-forget). Pro detail / review jde
 * Petr do /ukoly nebo /denik ručně.
 */

type Mode = "task" | "journal";

const MODES = {
  task: {
    label: "Nahrát úkol",
    Icon: CheckSquare,
    endpoint: "/api/ukoly/audio",
    limitMin: 10,
    name: "task-salva",
  },
  journal: {
    label: "Nahrát deník",
    Icon: BookOpen,
    endpoint: "/api/denik/audio",
    limitMin: 15,
    name: "denik",
  },
} as const;

type Phase = "idle" | "recording" | "uploading" | "error" | "success";

export default function QuickRecordButton({ mode }: { mode: Mode }) {
  const cfg = MODES[mode];
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const limitSec = cfg.limitMin * 60;

  async function startRecording() {
    setError(null);
    setPhase("idle");
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
        await upload(blob, Math.round(finalMs / 1000));
      };

      mr.start();
      startedAtRef.current = Date.now();
      setPhase("recording");
      setElapsedMs(0);

      tickRef.current = setInterval(() => {
        const e = Date.now() - startedAtRef.current;
        setElapsedMs(e);
        if (e >= limitSec * 1000) stopRecording();
      }, 250);
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
    const fd = new FormData();
    const ext = audio.type.includes("webm") ? "webm" : audio.type.includes("mp4") ? "mp4" : "audio";
    fd.append("audio", new File([audio], `${cfg.name}.${ext}`, { type: audio.type }));
    fd.append("durationSec", String(durationSec));
    if (mode === "journal") {
      fd.append("date", new Date().toISOString().slice(0, 10));
    }

    setPhase("uploading");
    try {
      const res = await fetch(cfg.endpoint, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Upload selhal (${res.status})`);
        setPhase("error");
        return;
      }
      setPhase("success");
      // Po 3s zpět na idle (success indicator → mic icon)
      setTimeout(() => { setPhase("idle"); setElapsedMs(0); }, 3000);
    } catch (e) {
      setError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("error");
    }
  }

  const elM = Math.floor(elapsedMs / 60000);
  const elS = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");
  const progressPercent = Math.min(100, (elapsedMs / (limitSec * 1000)) * 100);

  const ModeIcon = cfg.Icon;
  const isRecording = phase === "recording";
  const isBusy = phase === "uploading";

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={isRecording ? stopRecording : isBusy ? undefined : startRecording}
        disabled={isBusy}
        className={`relative w-full overflow-hidden rounded-xl p-4 border transition flex items-center gap-3 ${
          isRecording
            ? "border-[color:var(--c-signal)] bg-[color:var(--c-signal)]/10"
            : phase === "success"
              ? "border-foreground/40 bg-accent/40"
              : phase === "error"
                ? "border-destructive/40 bg-destructive/10"
                : "border-border bg-card hover:border-foreground/40 hover:bg-accent/40"
        }`}
      >
        {/* Progress fill bar (jen při recording) */}
        {isRecording && (
          <div
            className="absolute inset-y-0 left-0 bg-[color:var(--c-signal)]/15 transition-all pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />
        )}

        <div className={`relative size-10 rounded-full grid place-items-center shrink-0 ${
          isRecording
            ? "bg-[color:var(--c-signal)] text-white animate-pulse"
            : phase === "success"
              ? "bg-foreground/10 text-foreground"
              : phase === "error"
                ? "bg-destructive/20 text-destructive"
                : "bg-accent/60 text-foreground"
        }`}>
          {isBusy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : isRecording ? (
            <Square className="size-4 fill-current" />
          ) : phase === "success" ? (
            <CheckSquare className="size-5" />
          ) : phase === "error" ? (
            <AlertTriangle className="size-5" />
          ) : (
            <Mic className="size-5" />
          )}
        </div>

        <div className="relative flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <ModeIcon className="size-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {isRecording ? `Nahrávám ${cfg.label.toLowerCase().replace("nahrát ", "")}` :
               isBusy ? "Nahrávám na server…" :
               phase === "success" ? "Nahrávka odeslána" :
               phase === "error" ? "Chyba" :
               cfg.label}
            </span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
            {isRecording ? (
              <span className="text-[color:var(--c-signal)]">
                {elM}:{elS} / max {cfg.limitMin} min · klik = stop
              </span>
            ) : phase === "error" ? (
              <span className="text-destructive line-clamp-1">{error ?? "Selhalo"}</span>
            ) : phase === "success" ? (
              <>AI zpracovává na pozadí · jdi do /{mode === "task" ? "ukoly" : "denik"}</>
            ) : (
              <>klik = start · max {cfg.limitMin} min</>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}
