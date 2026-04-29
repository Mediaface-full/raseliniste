import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, AlertTriangle, Upload, FileAudio } from "lucide-react";

const STANDARD_LIMIT_SEC = 3 * 60; // 3 min — úkolová salva
const TICK_MS = 250;

type Phase = "idle" | "recording" | "uploading" | "redirecting" | "error";

export default function TaskAudioRecorder() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const briefInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
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
        if (e >= STANDARD_LIMIT_SEC * 1000) stopRecording();
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
    fd.append("audio", new File([audio], `task-salva.${ext}`, { type: audio.type }));
    fd.append("durationSec", String(durationSec));

    try {
      const res = await fetch("/api/ukoly/audio", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setPhase("error");
        setError(data.error ?? `Server vrátil ${res.status}`);
        return;
      }
      setPhase("redirecting");
      // Přesměruj na review screen — UI tam pollne dokud nebude status=review
      window.location.href = `/ukoly/audio/${data.batchId}/review`;
    } catch (e) {
      setPhase("error");
      setError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function uploadFile(file: File) {
    await upload(file, 0);
  }

  const remM = Math.floor((STANDARD_LIMIT_SEC * 1000 - elapsedMs) / 60000);
  const remS = Math.floor(((STANDARD_LIMIT_SEC * 1000 - elapsedMs) % 60000) / 1000).toString().padStart(2, "0");
  const elM = Math.floor(elapsedMs / 60000);
  const elS = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, "0");

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="font-serif text-2xl">Nadiktuj úkoly</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mluv tak, jak ti to plyne — AI pak vyrobí seznam úkolů, který si projdeš a potvrdíš.
        </p>
      </div>

      <div className="glass-strong rounded-xl p-6 text-center min-h-[280px] flex flex-col items-center justify-center gap-4">
        {phase === "idle" && (
          <>
            <button
              onClick={startRecording}
              className="size-24 rounded-full bg-[var(--tint-peach)] text-black grid place-items-center shadow-xl hover:scale-105 transition-transform active:scale-95"
            >
              <Mic className="size-10" />
            </button>
            <div className="text-base font-medium">Tap pro záznam</div>
            <div className="text-xs text-muted-foreground font-mono">
              max 3 min · auto-stop
            </div>
            <button
              onClick={() => briefInputRef.current?.click()}
              className="mt-2 text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              Nahrát soubor →
            </button>
            <input
              ref={briefInputRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.webm,.mp4"
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
            <div className="font-mono text-4xl tabular-nums">{remM}:{remS}</div>
            <div className="text-xs text-muted-foreground font-mono">uplynulo {elM}:{elS}</div>
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
            <Loader2 className="size-12 animate-spin text-[var(--tint-peach)]" />
            <div className="text-base font-medium">
              {phase === "uploading" ? "Nahrávám…" : "Otevírám review…"}
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

      <details className="glass rounded-xl px-5 py-4 text-sm">
        <summary className="cursor-pointer font-medium">Tip: jak diktovat</summary>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>Mluv plynule, AI z toho vyrobí oddělené úkoly. Příklad:</p>
          <p className="italic bg-black/20 rounded p-2 font-mono text-xs">
            „Zítra zavolat Honzovi kvůli střeše, do pátku poslat fakturu Wonderhood,
            někdy příští týden domluvit servis na auto, a ještě koupit Mortykovi krmení."
          </p>
          <p>→ AI vyrobí 4 oddělené úkoly s termíny a tagy.</p>
          <p>Můžeš taky říct <em>„Karel ať udělá X"</em> — AI to označí jako delegovaný úkol.</p>
        </div>
      </details>
    </div>
  );
}
