import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, CheckCircle2, AlertTriangle, Upload, FileAudio, X, Lock, EyeOff } from "lucide-react";
import { useRecordingProtection, recordingProtectionTip } from "./useRecordingProtection";

interface Project {
  id: string;
  name: string;
  homeTitle: string | null;
  description: string | null;
  canRecordBrief: boolean;
}

type Phase = "idle" | "recording" | "uploading" | "processing" | "done" | "error";

const STANDARD_LIMIT_SEC = 10 * 60; // 10 minut
const TICK_MS = 250;

export default function GuestRecorder({
  token,
  initialProjects,
  guestName,
}: {
  token: string;
  initialProjects: Project[];
  guestName: string;
}) {
  const [projects] = useState<Project[]>(initialProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjects[0]?.id ?? "",
  );
  const selected = projects.find((p) => p.id === selectedProjectId);

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

  // Cleanup při unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (projects.length === 0) {
    return (
      <div className="glass-strong rounded-xl p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Petr tě zatím nepozval do žádného projektu. Zkus odkaz později nebo se ho zeptej.
        </p>
      </div>
    );
  }

  function pickMime(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mp4;codecs=mp4a",
      "audio/ogg;codecs=opus",
    ];
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) return c;
      } catch {
        /* ignore */
      }
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
      mr.onstop = () => {
        // Upload se spustí ručně po stop (vidíme `phase` change)
      };
      mr.start();
      startedAtRef.current = Date.now();
      await protection.start();
      tickRef.current = window.setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms >= STANDARD_LIMIT_SEC * 1000) {
          stopRecording(true);
        }
      }, TICK_MS);
    } catch (e) {
      setPhase("error");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
        setError(
          "Nepustil jsi mě k mikrofonu. Otevři nastavení prohlížeče a povol mikrofon pro tuhle stránku.",
        );
      } else {
        setError(`Mikrofon nelze spustit: ${msg}`);
      }
    }
  }

  async function stopRecording(autoStop = false) {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;

    const stopPromise = new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
    });
    mr.stop();
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    await stopPromise;

    const finalMs = Date.now() - startedAtRef.current;
    const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
    const warning = protection.stop(blob, finalMs);
    if (warning && !confirm(`${warning}\n\nChceš přesto poslat co máš?`)) {
      setPhase("idle");
      return;
    }
    await uploadAudio(blob, "STANDARD", Math.round(finalMs / 1000));
  }

  async function uploadAudio(audio: Blob, type: "STANDARD" | "BRIEF", durationSec: number) {
    setPhase("uploading");
    setError(null);

    const fd = new FormData();
    fd.append("projectId", selectedProjectId);
    fd.append("type", type);
    fd.append("durationSec", String(durationSec));
    const filename = type === "BRIEF" ? `brief.${getExtensionFromMime(audio.type)}` : `recording.${getExtensionFromMime(audio.type)}`;
    fd.append("audio", new File([audio], filename, { type: audio.type }));

    try {
      // Po upload bytí setPhase("processing")
      const res = await fetch(`/api/me/${token}/recording`, {
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
      // Reset po 4 sec, ať může nahrát další
      setTimeout(() => {
        setPhase("idle");
        setBriefMode(false);
        setBriefFile(null);
        setElapsedMs(0);
      }, 4000);
    } catch (e) {
      setPhase("error");
      setError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function uploadBriefFile() {
    if (!briefFile) return;
    // Nemůžeme z file zjistit délku spolehlivě bez ffmpeg, dáme 0
    await uploadAudio(briefFile, "BRIEF", 0);
  }

  const remainingMs = Math.max(0, STANDARD_LIMIT_SEC * 1000 - elapsedMs);
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");

  return (
    <div className="space-y-4">
      {/* Project selector — ukáže se vždy, i když 1 projekt (vidí kontext) */}
      <div className="glass-strong rounded-xl p-4">
        <label className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono mb-1.5">
          Projekt
        </label>
        {projects.length === 1 ? (
          <div className="font-medium text-sm py-1">{selected?.name}</div>
        ) : (
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={phase !== "idle"}
            className="w-full px-3 py-2.5 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-base"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {selected?.description && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{selected.description}</p>
        )}
      </div>

      {/* Hlavní recording UI */}
      <div className="glass-strong rounded-xl p-6 text-center min-h-[280px] flex flex-col items-center justify-center gap-4">
        {phase === "idle" && !briefMode && (
          <>
            <button
              onClick={startRecording}
              className="size-24 rounded-full bg-[var(--tint-peach)] text-black grid place-items-center shadow-xl shadow-black/30 hover:scale-105 transition-transform active:scale-95"
              aria-label="Začít nahrávat"
            >
              <Mic className="size-10" />
            </button>
            <div className="text-base font-medium">Tap pro záznam</div>
            <div className="text-xs text-muted-foreground font-mono">
              max 10 min · auto-stop
            </div>
            <div className="text-xs text-muted-foreground/80 max-w-sm leading-relaxed text-center">
              {recordingProtectionTip(protection.wakeLockSupported)}
            </div>

            {selected?.canRecordBrief && (
              <button
                onClick={() => setBriefMode(true)}
                className="mt-3 text-xs font-mono text-muted-foreground hover:text-foreground underline"
              >
                Klíčový brief — nahrát soubor →
              </button>
            )}
          </>
        )}

        {phase === "idle" && briefMode && (
          <>
            <FileAudio className="size-12 text-[var(--tint-mint)]" />
            <div className="text-base font-medium">Klíčový brief</div>
            <div className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              Vyber audio soubor (m4a, mp3, wav, webm). Doporučujeme nahrát ho v Hlasových
              poznámkách a sem ho uploadovat.
            </div>
            {briefFile ? (
              <div className="flex flex-col items-center gap-2 w-full">
                <div className="text-sm font-mono">{briefFile.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(briefFile.size / 1024 / 1024)} MB
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={uploadBriefFile}
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
              </div>
            ) : (
              <>
                <button
                  onClick={() => briefInputRef.current?.click()}
                  className="px-5 py-3 rounded-md bg-[var(--tint-mint)] text-black font-medium flex items-center gap-2"
                >
                  <Upload className="size-4" /> Vybrat soubor
                </button>
                <input
                  ref={briefInputRef}
                  type="file"
                  accept="audio/*,.m4a,.mp3,.wav,.webm,.mp4"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setBriefFile(f);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            <button
              onClick={() => {
                setBriefMode(false);
                setBriefFile(null);
              }}
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
            <div className="font-mono text-4xl tabular-nums">
              {remainingMin}:{remainingSec}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              uplynulo {elapsedMin}:{elapsedSec}
            </div>
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
                ⚠ Přepnul jsi mimo stránku — část záznamu může chybět.
              </div>
            )}
            <button
              onClick={() => stopRecording(false)}
              className="mt-2 px-6 py-3 rounded-md bg-foreground/90 text-background font-medium flex items-center gap-2"
            >
              <Square className="size-4 fill-current" /> Stop
            </button>
          </>
        )}

        {phase === "uploading" && (
          <>
            <Loader2 className="size-12 animate-spin text-[var(--tint-peach)]" />
            <div className="text-base font-medium">Nahrávám záznam…</div>
            <div className="text-xs text-muted-foreground">vydrž chvilku</div>
          </>
        )}

        {phase === "processing" && (
          <>
            <Loader2 className="size-12 animate-spin text-[var(--tint-mint)]" />
            <div className="text-base font-medium">AI zpracovává…</div>
            <div className="text-xs text-muted-foreground">to chvilku trvá, neopouštěj stránku</div>
          </>
        )}

        {phase === "done" && (
          <>
            <CheckCircle2 className="size-16 text-[var(--tint-sage)]" />
            <div className="text-lg font-medium">Záznam uložen ✓</div>
            <div className="text-xs text-muted-foreground">díky!</div>
            <button
              onClick={() => {
                setPhase("idle");
                setBriefMode(false);
                setBriefFile(null);
                setElapsedMs(0);
              }}
              className="mt-2 px-4 py-2 rounded-md hover:bg-white/5 text-sm text-muted-foreground"
            >
              Nahrát další
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <AlertTriangle className="size-12 text-destructive" />
            <div className="text-base font-medium">Něco se pokazilo</div>
            <div className="text-xs text-destructive max-w-xs">{error}</div>
            <button
              onClick={() => {
                setPhase("idle");
                setError(null);
              }}
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

function getExtensionFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "bin";
}
