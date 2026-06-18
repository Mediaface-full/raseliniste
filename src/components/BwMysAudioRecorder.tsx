import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useRecordingProtection, recordingProtectionTip } from "./useRecordingProtection";

type Phase = "idle" | "recording" | "uploading" | "processing" | "done" | "error";

const LIMIT_SEC = 10 * 60; // 10 min max — zápisy by měly být stručné, ale 5 min bylo občas málo
const TICK_MS = 250;

export default function BwMysAudioRecorder({
  decisionId,
  onClose,
}: {
  decisionId: string;
  onClose: (created: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const protection = useRecordingProtection();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function pickMime(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const c of candidates) {
      try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ }
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
      const mime = pickMime();
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start();
      startedAtRef.current = Date.now();
      await protection.start();
      tickRef.current = window.setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= LIMIT_SEC * 1000) stopRecording();
      }, TICK_MS);
    } catch (e) {
      setPhase("error");
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")
        ? "Nepustil jsi mě k mikrofonu. Otevři nastavení prohlížeče."
        : `Mikrofon nelze spustit: ${msg}`);
    }
  }

  async function stopRecording() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;

    const stopPromise = new Promise<void>((resolve) => { mr.onstop = () => resolve(); });
    mr.stop();
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    await stopPromise;

    const finalMs = Date.now() - startedAtRef.current;
    const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
    protection.stop(blob, finalMs);
    await uploadAudio(blob);
  }

  async function uploadAudio(blob: Blob) {
    setPhase("uploading");
    setError(null);

    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "m4a" : "bin";
    const fd = new FormData();
    fd.append("audio", new File([blob], `entry.${ext}`, { type: blob.type }));

    try {
      setPhase("processing"); // přepiš na processing po uploadu
      const res = await fetch(`/api/bwmys/${decisionId}/entry-audio`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPhase("error");
        setError(data.error ?? `Server vrátil ${res.status}.`);
        return;
      }
      setPhase("done");
      setTimeout(() => onClose(true), 1200);
    } catch (e) {
      setPhase("error");
      setError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const elM = Math.floor(elapsedMs / 60000);
  const elS = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-md w-full p-6 text-center space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-serif text-lg">Nahrát zápis</div>
          <button onClick={() => onClose(false)} className="p-1 hover:bg-white/5 rounded">
            <X className="size-4" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          AI rozpozná z přepisu náladu, typ a úhel pohledu. Ty si je v zápise pak můžeš upravit.
        </div>

        <div className="min-h-[200px] flex flex-col items-center justify-center gap-4">
          {phase === "idle" && (
            <>
              <button
                onClick={startRecording}
                className="size-20 rounded-full bg-[var(--tint-lavender)] text-black grid place-items-center shadow-xl hover:scale-105 transition-transform active:scale-95"
              >
                <Mic className="size-8" />
              </button>
              <div className="text-sm text-muted-foreground">Tap pro záznam · max 10 min</div>
              <div className="text-xs text-muted-foreground/80 max-w-xs leading-relaxed">
                {recordingProtectionTip(protection.wakeLockSupported)}
              </div>
            </>
          )}

          {phase === "recording" && (
            <>
              <div className="size-20 rounded-full bg-destructive/20 grid place-items-center animate-pulse">
                <div className="size-10 rounded-full bg-destructive" />
              </div>
              <div className="font-mono text-3xl tabular-nums">{elM}:{elS}</div>
              <button
                onClick={stopRecording}
                className="px-6 py-3 rounded-md bg-foreground/90 text-background font-medium flex items-center gap-2"
              >
                <Square className="size-4 fill-current" /> Stop
              </button>
            </>
          )}

          {(phase === "uploading" || phase === "processing") && (
            <>
              <Loader2 className="size-12 animate-spin text-[var(--tint-lavender)]" />
              <div className="text-sm">{phase === "uploading" ? "Nahrávám…" : "AI zpracovává…"}</div>
              <div className="text-xs text-muted-foreground">vydrž chvilku</div>
            </>
          )}

          {phase === "done" && (
            <>
              <CheckCircle2 className="size-12 text-[var(--tint-sage)]" />
              <div className="text-sm">Zápis vytvořen </div>
            </>
          )}

          {phase === "error" && (
            <>
              <AlertTriangle className="size-12 text-destructive" />
              <div className="text-xs text-destructive max-w-xs">{error}</div>
              <button onClick={() => { setPhase("idle"); setError(null); }} className="text-xs underline">
                Zkusit znovu
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
