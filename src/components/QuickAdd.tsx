import { useState, useRef, useEffect } from "react";
import {
  Mic, MicOff, Loader2, Send, AlertTriangle, Info, MapPin, Clock, Calendar as Cal,
  CheckCircle2, XCircle, Trash2,
} from "lucide-react";
import { Button } from "./ui/Button";

type Verdict = "GREEN" | "YELLOW" | "RED";
type Severity = "INFO" | "WARNING" | "ERROR";
interface Signal { rule: string; severity: Severity; message: string; }
interface ParsedEvent {
  title: string;
  type: string;
  locationName: string | null;
  startsAt: string;
  endsAt: string;
  confidence: number;
  description?: string | null;
}
interface SurroundingEvent {
  id: string;
  title: string;
  type: string;
  source: string;
  startsAt: string;
  endsAt: string;
  locationText: string | null;
  allDay: boolean;
}
interface ParseResponse {
  parsed: ParsedEvent | null;
  needsClarification: string | null;
  evaluation: { verdict: Verdict; signals: Signal[] } | null;
  surroundingEvents: SurroundingEvent[];
}

export default function QuickAdd() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [data, setData] = useState<ParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const recRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced parse
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input.trim()) {
      setData(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void parse(input);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  async function parse(text: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/parse-and-evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ freeText: text }),
      });
      const json = (await res.json()) as ParseResponse | { error: string };
      if (!res.ok) {
        setError("error" in json ? json.error : "Parser selhal.");
        return;
      }
      setData(json as ParseResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit(override: boolean) {
    if (!data?.parsed) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: data.parsed.title,
          type: data.parsed.type,
          startsAt: data.parsed.startsAt,
          endsAt: data.parsed.endsAt,
          locationName: data.parsed.locationName,
          description: data.parsed.description,
          manualOverride: override,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === "VERDICT_RED") {
          setError("Verdict je červený. Použij „Přesto zapsat“ pokud opravdu chceš.");
        } else {
          setError(json.error ?? "Zápis selhal.");
        }
        return;
      }
      setSuccess(`Zapsáno do Google ✓ ${json.meetLink ? `(Meet: ${json.meetLink})` : ""}`);
      setInput("");
      setData(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  function clearAll() {
    setInput("");
    setData(null);
    setError(null);
    setSuccess(null);
  }

  // Web Speech API (cz)
  const speechSupported =
    typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "cs-CZ";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setRecording(true);
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    rec.onresult = (ev: any) => {
      const txt = ev.results[0][0].transcript;
      setInput(txt);
    };
    rec.start();
    recRef.current = rec;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Co a kdy? Třeba: úterý 11 ČSOB Praha"
            rows={3}
            className="w-full rounded-lg border border-border bg-input px-4 py-3 pr-14 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background resize-none transition-colors"
          />
          {speechSupported && (
            <button
              type="button"
              onClick={toggleMic}
              className={`absolute right-2 bottom-2 size-10 rounded-lg grid place-items-center transition ${
                recording
                  ? "bg-[var(--tint-rose)]/30 text-[var(--tint-rose)]"
                  : "bg-white/5 hover:bg-white/10 text-muted-foreground"
              }`}
              title={recording ? "Zastavit nahrávání" : "Diktovat (čeština)"}
            >
              {recording ? <MicOff className="size-5 animate-pulse" /> : <Mic className="size-5" />}
            </button>
          )}
        </div>

        {(input || data) && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={committing}>
              <Trash2 /> Zahodit
            </Button>
            {busy && <span className="text-xs text-muted-foreground self-center"><Loader2 className="inline size-3 animate-spin" /> Parsuju…</span>}
          </div>
        )}
      </div>

      {success && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-[var(--tint-sage)]" /> {success}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {data?.needsClarification && !data.parsed && (
        <div className="glass rounded-xl p-4 text-sm">
          <strong>Doplň prosím:</strong> {data.needsClarification}
        </div>
      )}

      {data?.parsed && (
        <>
          <ParsedSummary parsed={data.parsed} verdict={data.evaluation?.verdict ?? null} />

          {data.evaluation && data.evaluation.signals.length > 0 && (
            <SignalsList signals={data.evaluation.signals} />
          )}

          {data.surroundingEvents.length > 0 && (
            <Timeline events={data.surroundingEvents} newStart={data.parsed.startsAt} newEnd={data.parsed.endsAt} />
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            {data.evaluation?.verdict === "GREEN" ? (
              <Button onClick={() => commit(false)} disabled={committing}>
                {committing ? <><Loader2 className="animate-spin" /> Zapisuji…</> : <><Send /> Zapsat do Google</>}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => commit(true)}
                  disabled={committing}
                  className="border-[var(--tint-butter)]/40 text-[var(--tint-butter)]"
                >
                  {committing ? <><Loader2 className="animate-spin" /> Zapisuji…</> : <><Send /> Přesto zapsat</>}
                </Button>
                <span className="text-xs text-muted-foreground self-center">
                  {data.evaluation?.verdict === "RED"
                    ? "Verdict červený — opravdu jen pokud víš co děláš."
                    : "Verdict žlutý — projdi varování."}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ParsedSummary({ parsed, verdict }: { parsed: ParsedEvent; verdict: Verdict | null }) {
  const start = new Date(parsed.startsAt);
  const end = new Date(parsed.endsAt);
  const dateStr = start.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeStr = `${start.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
  const tint = verdictTint(verdict);

  return (
    <div className="glass rounded-xl p-5" style={{ ["--c" as string]: tint }}>
      <div className="flex items-start gap-3">
        <VerdictBadge verdict={verdict} />
        <div className="flex-1">
          <div className="font-serif text-xl">{parsed.title}</div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Cal className="size-4" /> <span className="font-mono">{dateStr}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-4" /> <span className="font-mono">{timeStr}</span>
            </div>
            {parsed.locationName && (
              <div className="flex items-center gap-2 text-muted-foreground sm:col-span-2">
                <MapPin className="size-4" /> {parsed.locationName} <span className="text-xs ml-2 font-mono">[{parsed.type}]</span>
              </div>
            )}
          </div>
          {parsed.description && (
            <div className="mt-2 text-xs text-muted-foreground italic">{parsed.description}</div>
          )}
          {parsed.confidence < 0.8 && (
            <div className="mt-2 text-xs text-[var(--tint-butter)]">
              ⚠ Nízká jistota parsování ({(parsed.confidence * 100).toFixed(0)} %) — zkontroluj.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return null;
  const map = {
    GREEN: { icon: <CheckCircle2 />, label: "🟢", color: "var(--tint-sage)" },
    YELLOW: { icon: <AlertTriangle />, label: "🟡", color: "var(--tint-butter)" },
    RED: { icon: <XCircle />, label: "🔴", color: "var(--tint-rose)" },
  } as const;
  const item = map[verdict];
  return (
    <div
      className="size-12 rounded-full grid place-items-center text-2xl shrink-0"
      style={{ background: `color-mix(in oklch, ${item.color} 20%, transparent)`, color: item.color }}
    >
      <span aria-label={verdict}>{item.label}</span>
    </div>
  );
}

function SignalsList({ signals }: { signals: Signal[] }) {
  return (
    <div className="glass rounded-xl p-4 space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Pravidla</div>
      <ul className="space-y-1.5">
        {signals.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <SignalIcon severity={s.severity} />
            <div>
              <span>{s.message}</span>
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">{s.rule}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalIcon({ severity }: { severity: Severity }) {
  if (severity === "ERROR") return <XCircle className="size-4 text-[var(--tint-rose)] shrink-0 mt-0.5" />;
  if (severity === "WARNING") return <AlertTriangle className="size-4 text-[var(--tint-butter)] shrink-0 mt-0.5" />;
  return <Info className="size-4 text-[var(--tint-sky)] shrink-0 mt-0.5" />;
}

function Timeline({
  events,
  newStart,
  newEnd,
}: {
  events: SurroundingEvent[];
  newStart: string;
  newEnd: string;
}) {
  const all = [
    ...events.map((e) => ({ ...e, isNew: false })),
    {
      id: "_new",
      title: "« nový »",
      type: "NEW",
      source: "DRAFT",
      startsAt: newStart,
      endsAt: newEnd,
      locationText: null,
      allDay: false,
      isNew: true,
    },
  ].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return (
    <div className="glass rounded-xl p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-3">Den</div>
      <div className="space-y-1.5">
        {all.map((e) => {
          const start = new Date(e.startsAt);
          const end = new Date(e.endsAt);
          const time = e.allDay
            ? "celý den"
            : `${start.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
          return (
            <div
              key={e.id}
              className={`flex items-center gap-3 text-sm rounded-md px-2 py-1.5 ${
                e.isNew
                  ? "bg-[var(--tint-sky)]/15 border border-[var(--tint-sky)]/40"
                  : "bg-black/10"
              }`}
            >
              <span className="font-mono text-xs tabular w-24 shrink-0 text-muted-foreground">{time}</span>
              <span className="flex-1 truncate">{e.title}</span>
              {e.locationText && <span className="text-xs text-muted-foreground truncate max-w-[8rem]">{e.locationText}</span>}
              <SourceBadge source={e.source} type={e.type} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceBadge({ source, type }: { source: string; type: string }) {
  if (source === "DRAFT") return <span className="text-xs font-mono text-[var(--tint-sky)]">nový</span>;
  if (source === "ICLOUD_SON") return <span className="text-xs font-mono text-[var(--tint-mint)]">syn</span>;
  if (source === "ICLOUD_PARTNER") return <span className="text-xs font-mono text-[var(--tint-lavender)]">partnerka</span>;
  if (type === "OOO_FULL") return <span className="text-xs font-mono text-[var(--tint-butter)]">OOO</span>;
  return <span className="text-xs font-mono text-muted-foreground">G</span>;
}

function verdictTint(v: Verdict | null): string {
  if (v === "GREEN") return "var(--tint-sage)";
  if (v === "YELLOW") return "var(--tint-butter)";
  if (v === "RED") return "var(--tint-rose)";
  return "var(--tint-sky)";
}
