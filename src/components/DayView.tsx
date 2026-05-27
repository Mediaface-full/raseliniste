import { useState } from "react";
import {
  Plus, Trash2, Check, Loader2, Sparkles, AlertTriangle, Info, XCircle,
  ChevronLeft, ChevronRight, Calendar as CalIcon, MapPin, Clock, RotateCw,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import DayTimeline from "./DayTimeline";

interface CalendarEvent {
  id: string;
  title: string;
  type: string;
  source: string;
  startsAt: string;
  endsAt: string;
  locationText: string | null;
  description: string | null;
  prepNote: string | null;
  itemsToBring: unknown;
  allDay: boolean;
}
interface DayNote {
  id: string;
  text: string;
  area: string | null;
  done: boolean;
  doneAt: string | null;
}
interface RuleViolation {
  id: string;
  ruleName: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  acknowledged: boolean;
}
interface BriefingDigest {
  id: string;
  forDate: string;
  generatedAt: string;
  content: unknown;
  todoistTaskId: string | null;
  pushedAt: string | null;
}

interface Initial {
  date: string;                  // YYYY-MM-DD
  events: CalendarEvent[];
  dayNotes: DayNote[];
  briefingDigest: BriefingDigest | null;
  ruleViolations: RuleViolation[];
}

export default function DayView({ initial }: { initial: Initial }) {
  const [date] = useState(initial.date);
  const [events] = useState<CalendarEvent[]>(initial.events);
  const [dayNotes, setDayNotes] = useState<DayNote[]>(initial.dayNotes);
  const [violations] = useState<RuleViolation[]>(initial.ruleViolations);
  const [briefing, setBriefing] = useState<BriefingDigest | null>(initial.briefingDigest);

  const [newText, setNewText] = useState("");
  const [newArea, setNewArea] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dateObj = new Date(`${date}T00:00:00`);
  const dateLabel = dateObj.toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Detekce fullscreen módu z URL — šipky a switch tabů musí query string
  // zachovat, jinak Petr vypadne z rituálního prostoru
  const isFullscreen = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("naplno") === "1";
  const qs = isFullscreen ? "?naplno=1" : "";

  function dayHref(delta: number): string {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `/day/${y}-${m}-${day}${qs}`;
  }

  async function addNote() {
    if (!newText.trim()) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch(`/api/day/${date}/note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: newText.trim(), area: newArea.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Přidání selhalo.");
        return;
      }
      setDayNotes((prev) => [...prev, data.note]);
      setNewText("");
      setNewArea("");
    } finally {
      setBusy(null);
    }
  }

  async function toggleDone(note: DayNote) {
    setBusy(`toggle-${note.id}`);
    try {
      const res = await fetch(`/api/day-notes/${note.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: !note.done }),
      });
      const data = await res.json();
      if (res.ok) {
        setDayNotes((prev) => prev.map((n) => (n.id === note.id ? data.note : n)));
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteNote(id: string) {
    setBusy(`del-${id}`);
    try {
      const res = await fetch(`/api/day-notes/${id}`, { method: "DELETE" });
      if (res.ok) setDayNotes((prev) => prev.filter((n) => n.id !== id));
    } finally {
      setBusy(null);
    }
  }

  async function generateBriefing(force: boolean) {
    setBusy("brief");
    setError(null);
    try {
      const res = await fetch(`/api/day/${date}/briefing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force, push: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generování selhalo.");
        return;
      }
      // Reload briefing data
      const dayRes = await fetch(`/api/day/${date}`);
      const dayData = await dayRes.json();
      setBriefing(dayData.briefingDigest);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Přepínač Den / Týden / Měsíc */}
      <div className="flex items-center justify-center gap-1">
        <span className="px-3 py-1 rounded-md bg-white/10 text-xs font-mono">Den</span>
        <a
          href={`/calendar/tyden/${date}${qs}`}
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Týden
        </a>
        <a
          href={`/calendar/mesic/${date.slice(0, 7)}${qs}`}
          className="px-3 py-1 rounded-md text-xs font-mono text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          Měsíc
        </a>
      </div>

      {/* Hlavička s navigací */}
      <div className="flex items-center justify-between gap-3">
        <a
          href={dayHref(-1)}
          className="size-11 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center"
          title="Předchozí den"
        >
          <ChevronLeft className="size-5" />
        </a>
        <div className="text-center flex-1">
          <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
            {date}
          </div>
          <h1 className="font-serif text-2xl">{dateLabel}</h1>
          <a
            href={`/dnes${qs}`}
            className="text-[10px] uppercase tracking-widest font-mono text-[var(--tint-sky)] hover:underline"
          >
            ↻ dnes
          </a>
        </div>
        {/* Petr 2026-05-27 #3 + #14: Sync tlačítko + zvětšené ikony v header */}
        <button
          onClick={async () => {
            setBusy("sync");
            setError(null);
            try {
              const res = await fetch("/api/integrations/google/sync", { method: "POST" });
              if (res.ok) window.location.reload();
              else {
                const data = await res.json().catch(() => ({}));
                setError(`Sync selhal: ${data.error ?? `HTTP ${res.status}`}`);
              }
            } catch (e) {
              setError(`Sync selhal: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy === "sync"}
          className="size-11 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center disabled:opacity-50"
          title="Stáhnout změny z Google Calendar (jinak za max 5 min)"
        >
          {busy === "sync" ? <Loader2 className="size-5 animate-spin" /> : <RotateCw className="size-5" />}
        </button>
        <a
          href={dayHref(1)}
          className="size-11 rounded-md bg-white/5 hover:bg-white/10 grid place-items-center"
          title="Následující den"
        >
          <ChevronRight className="size-5" />
        </a>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Při cestě — manuální DayNote per den (úkoly k vyřízení cestou) */}
      <section className="glass rounded-xl p-5" style={{ ["--c" as string]: "var(--tint-peach)" }}>
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="size-4" style={{ color: "var(--c)" }} />
          <h2 className="font-serif text-lg">Při cestě</h2>
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            {dayNotes.filter((n) => !n.done).length} otevřené
          </span>
        </div>

        <div className="space-y-2">
          {dayNotes.length === 0 && (
            <div className="text-sm text-muted-foreground italic">Žádné pochůzky. Přidej co potřebuješ stihnout cestou.</div>
          )}
          {dayNotes.map((n) => (
            <div
              key={n.id}
              className={`flex items-center gap-3 text-sm rounded-md px-3 py-2 ${
                n.done ? "bg-black/5 text-muted-foreground line-through" : "bg-black/15"
              }`}
            >
              <button
                onClick={() => toggleDone(n)}
                disabled={busy === `toggle-${n.id}`}
                className={`size-5 rounded border ${
                  n.done
                    ? "bg-[var(--tint-sage)]/40 border-[var(--tint-sage)]"
                    : "border-white/30"
                } grid place-items-center shrink-0`}
              >
                {n.done && <Check className="size-3" />}
              </button>
              <span className="flex-1">{n.text}</span>
              {n.area && <span className="text-xs font-mono text-muted-foreground">{n.area}</span>}
              <button
                onClick={() => deleteNote(n.id)}
                disabled={busy === `del-${n.id}`}
                className="text-muted-foreground hover:text-[var(--tint-rose)]"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Petr 2026-05-27: hint nad inputem — Petr nevěděl kam zadat „co vzít
            s sebou". Tady je to manuální cesta (DayNote per konkrétní den).
            AI itemsToBring (z Google event description) je automatická vrstva,
            tohle je „přidej ručně co tě napadlo". */}
        <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
          <div className="text-xs text-muted-foreground leading-relaxed">
            Sem napiš co vzít s sebou nebo kam zajet po cestě k dnešním
            schůzkám. Např. „vzít projektovou složku", „vyzvednout balíček
            v AlzaBoxu Smíchov".
          </div>
          <Input
            placeholder="Co stihnout cestou nebo vzít s sebou"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) addNote(); }}
          />
          <div className="flex gap-2">
            <Input
              placeholder="Oblast / lokalita (volitelně, např. Smíchov)"
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
              className="flex-1"
              title="Oblast je jen vizuální štítek vpravo u položky — pomáhá zorientovat se kam to zajet. Není povinné."
            />
            <Button onClick={addNote} disabled={Boolean(busy) || !newText.trim()}>
              {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Přidat
            </Button>
          </div>
        </div>
      </section>

      {/* Plán — vertikální timeline (DayTimeline). Důvod: Petr má time blindness,
          textový seznam je pro něj horší než vizuální plocha s bloky. */}
      <DayTimeline events={events} date={date} />

      {/* Pravidla */}
      {violations.length > 0 && (
        <section className="glass rounded-xl p-5" style={{ ["--c" as string]: "var(--tint-rose)" }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4" style={{ color: "var(--c)" }} />
            <h2 className="font-serif text-lg">Pravidla</h2>
          </div>
          <div className="space-y-2">
            {violations.map((v) => (
              <div
                key={v.id}
                className={`text-sm rounded-md p-3 border ${
                  v.severity === "ERROR"
                    ? "border-[var(--tint-rose)]/30 bg-[var(--tint-rose)]/10"
                    : v.severity === "WARNING"
                      ? "border-[var(--tint-butter)]/30 bg-[var(--tint-butter)]/10"
                      : "border-[var(--tint-sky)]/30 bg-[var(--tint-sky)]/10"
                }`}
              >
                <div className="flex items-start gap-2">
                  {v.severity === "ERROR" ? <XCircle className="size-4 shrink-0 mt-0.5" />
                    : v.severity === "WARNING" ? <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                    : <Info className="size-4 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="text-xs font-mono text-muted-foreground">{v.ruleName}</div>
                    <div>{v.message}</div>
                  </div>
                  {v.acknowledged && (
                    <span className="text-xs font-mono text-muted-foreground">vědomě</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Briefing */}
      <section className="glass rounded-xl p-5" style={{ ["--c" as string]: "var(--tint-rose)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="size-4" style={{ color: "var(--c)" }} />
          <h2 className="font-serif text-lg">Noční briefing</h2>
          {briefing && (
            <span className="ml-auto text-xs font-mono text-muted-foreground">
              vygenerováno {new Date(briefing.generatedAt).toLocaleString("cs-CZ")}
            </span>
          )}
        </div>

        {!briefing ? (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              Briefing pro tento den ještě neexistuje. Cron generuje denně ve 22:00 pro zítřek.
              Můžeš ho ale generovat manuálně.
            </p>
            <Button onClick={() => generateBriefing(false)} disabled={Boolean(busy)}>
              {busy === "brief" ? <><Loader2 className="animate-spin" /> Generuji…</> : <><Sparkles /> Vygenerovat teď</>}
            </Button>
          </>
        ) : (
          <>
            <div className="text-sm text-muted-foreground mb-3 flex items-center gap-3 flex-wrap">
              {briefing.todoistTaskId ? (
                <span className="text-[var(--tint-sage)]">✓ Pushnuto do Todoistu</span>
              ) : (
                <span className="text-[var(--tint-butter)]">⚠ Todoist push se nepodařil</span>
              )}
              <Button variant="outline" size="sm" onClick={() => generateBriefing(true)} disabled={Boolean(busy)}>
                {busy === "brief" ? <Loader2 className="animate-spin" /> : <Sparkles />} Přegenerovat
              </Button>
            </div>
            <BriefingPreview content={briefing.content as unknown as Record<string, unknown>} />
          </>
        )}
      </section>
    </div>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const time = event.allDay
    ? "celý den"
    : `${fmtTime(start)}–${fmtTime(end)}`;

  const tint = sourceTint(event.source);
  const label = sourceLabel(event.source);

  return (
    <div className="rounded-md p-3 bg-black/15 border border-white/5">
      <div className="flex items-start gap-3">
        <div className="font-mono text-xs tabular w-24 shrink-0 text-muted-foreground pt-0.5">
          <Clock className="inline size-3 mr-1" />
          {time}
        </div>
        <div className="flex-1">
          <div className="font-medium">{event.title}</div>
          {event.locationText && (
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <MapPin className="size-3" /> {event.locationText}
            </div>
          )}
          {event.prepNote && (
            <div className="text-xs text-[var(--tint-butter)] mt-1">📝 {event.prepNote}</div>
          )}
        </div>
        <span className={`text-xs font-mono ${tint}`}>{label}</span>
      </div>
    </div>
  );
}

function BriefingPreview({ content }: { content: Record<string, unknown> }) {
  const items = (content.itemsToBringAggregate as Array<{ name: string; sourceEventTitle: string }>) ?? [];
  const warnings = (content.contextWarnings as string[]) ?? [];
  const commute = content.commuteSummary as string | null;

  return (
    <div className="space-y-3 text-sm">
      {items.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1.5">🎒 Vzít s sebou</div>
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-3 rounded-sm border border-white/20" /> {it.name}
                <span className="text-xs text-muted-foreground">({it.sourceEventTitle})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1.5">💡 Kontext</div>
          <ul className="space-y-1 text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </div>
      )}
      {commute && (
        <div className="text-muted-foreground">🚌 {commute}</div>
      )}
    </div>
  );
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function sourceLabel(src: string): string {
  if (src === "ICLOUD_SON") return "syn";
  if (src === "ICLOUD_PARTNER") return "partnerka";
  return "G";
}

function sourceTint(src: string): string {
  if (src === "ICLOUD_SON") return "text-[var(--tint-mint)]";
  if (src === "ICLOUD_PARTNER") return "text-[var(--tint-lavender)]";
  return "text-[var(--tint-sky)]";
}
