import { useState, useEffect } from "react";
import {
  Loader2, Check, X, ChevronDown, AlertTriangle, RotateCw, Trash2, Save,
  Calendar, Tag, Sparkles, Volume2, VolumeX,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Mood = "ELATED" | "CONTENT" | "NEUTRAL" | "TIRED" | "STRESSED" | "DOWN" | "ANGRY" | "MIXED";
type Status = "draft" | "processing" | "ready" | "error";

interface Entry {
  id: string;
  date: string;
  createdAt: string;
  title: string | null;
  bodyMarkdown: string;
  rawTranscript: string | null;
  mood: Mood | null;
  tags: string[];
  highlights: string[];
  audioPath: string | null;
  audioRetainForever: boolean;
  audioDurationSec: number | null;
  status: Status;
  processingError: string | null;
}

const MOOD_LABELS: Record<Mood, string> = {
  ELATED: "🌟 nadšený",
  CONTENT: "🙂 v pohodě",
  NEUTRAL: "😐 neutrální",
  TIRED: "😴 unavený",
  STRESSED: "😰 ve stresu",
  DOWN: "😔 smutný",
  ANGRY: "😠 naštvaný",
  MIXED: "🌗 smíšené",
};

export default function JournalEntryView({ entryId }: { entryId: string }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<Mood | "">("");
  const [tags, setTags] = useState("");
  const [highlights, setHighlights] = useState("");

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  // Polling pokud processing
  useEffect(() => {
    if (entry?.status !== "processing") return;
    const interval = setInterval(() => void load(), 3000);
    return () => clearInterval(interval);
  }, [entry?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const res = await fetch(`/api/denik/${entryId}`);
      if (!res.ok) {
        setError("Zápis nenalezen.");
        return;
      }
      const data = await res.json();
      setEntry(data.entry);
      setTitle(data.entry.title ?? "");
      setBody(data.entry.bodyMarkdown ?? "");
      setMood(data.entry.mood ?? "");
      setTags((data.entry.tags ?? []).join(", "));
      setHighlights((data.entry.highlights ?? []).join("\n"));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/denik/${entryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || null,
          bodyMarkdown: body,
          mood: mood || null,
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
          highlights: highlights.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEntry(data.entry);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function regenerate(mode: "structure-only" | "full") {
    setError(null);
    const res = await fetch(`/api/denik/${entryId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Regenerace selhala.");
      return;
    }
    setEntry((e) => e ? { ...e, status: "processing" } : e);
  }

  async function deleteAudio() {
    if (!confirm("Smazat audio (text zápisu zůstane)?")) return;
    const res = await fetch(`/api/denik/${entryId}/audio`, { method: "DELETE" });
    if (res.ok) void load();
  }

  async function toggleRetain() {
    if (!entry) return;
    await fetch(`/api/denik/${entryId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioRetainForever: !entry.audioRetainForever }),
    });
    void load();
  }

  async function deleteEntry() {
    if (!confirm("Opravdu smazat celý zápis i audio?")) return;
    const res = await fetch(`/api/denik/${entryId}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/denik";
  }

  if (loading || !entry) {
    return <div className="text-center py-12 text-muted-foreground"><Loader2 className="size-8 animate-spin mx-auto" /></div>;
  }

  // PROCESSING
  if (entry.status === "processing") {
    return (
      <div className="glass-strong rounded-xl p-8 text-center">
        <Loader2 className="size-12 animate-spin text-[var(--tint-butter)] mx-auto mb-3" />
        <h1 className="font-serif text-xl mb-1">AI strukturuje zápis</h1>
        <p className="text-sm text-muted-foreground">15–60 s. Můžeš zatím dělat něco jiného, stránka se sama obnoví.</p>
      </div>
    );
  }

  const dateObj = new Date(entry.date);
  const dateStr = dateObj.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const audioRetentionDays = entry.audioPath
    ? Math.max(0, 7 - Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  return (
    <div className="space-y-4">
      {/* Hlavička */}
      <div className="flex items-center gap-3 flex-wrap">
        <a href="/denik" className="text-xs font-mono text-muted-foreground hover:text-foreground">← Deník</a>
        <span className="text-xs font-mono text-muted-foreground"><Calendar className="inline size-3" /> {dateStr}</span>
        {entry.mood && (
          <span className="text-xs font-mono text-[var(--tint-butter)]">{MOOD_LABELS[entry.mood]}</span>
        )}
      </div>

      {entry.processingError && (
        <div className="rounded-md border border-[var(--tint-butter)]/30 bg-[var(--tint-butter)]/10 text-sm px-3 py-2">
          ⚠ {entry.processingError}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Title + body */}
      {!editing ? (
        <article className="glass rounded-xl p-5 space-y-3">
          {entry.title && <h1 className="font-serif text-2xl">{entry.title}</h1>}
          {entry.highlights.length > 0 && (
            <ul className="border-l-2 border-[var(--tint-butter)]/40 pl-3 space-y-1 text-sm">
              {entry.highlights.map((h, i) => <li key={i}>• {h}</li>)}
            </ul>
          )}
          <div className="prose prose-invert max-w-none text-sm whitespace-pre-wrap leading-relaxed">
            {entry.bodyMarkdown}
          </div>
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-white/5">
              {entry.tags.map((t) => (
                <span key={t} className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-muted-foreground">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </article>
      ) : (
        <div className="glass rounded-xl p-5 space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={mood}
              onChange={(e) => setMood(e.target.value as Mood)}
              className="px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            >
              <option value="">— mood —</option>
              {Object.entries(MOOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tagy (čárkou)" />
          </div>
          <textarea
            value={highlights}
            onChange={(e) => setHighlights(e.target.value)}
            rows={3}
            placeholder="Highlights (1 na řádek)"
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Uložit
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}><X /> Zrušit</Button>
          </div>
        </div>
      )}

      {/* Akce */}
      <div className="glass rounded-xl p-4 flex flex-wrap items-center gap-2 text-sm">
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Upravit</Button>
        )}
        <Button size="sm" variant="outline" onClick={() => regenerate("structure-only")}>
          <Sparkles /> Přepsat AI
        </Button>
        {entry.audioPath && (
          <Button size="sm" variant="ghost" onClick={deleteAudio}>
            <VolumeX /> Smazat audio
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={deleteEntry} className="ml-auto text-destructive">
          <Trash2 /> Smazat zápis
        </Button>
      </div>

      {/* Surový přepis */}
      {entry.rawTranscript && (
        <details className="glass rounded-xl px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1">
            <ChevronDown className="size-3" /> Surový přepis ({entry.rawTranscript.length} znaků)
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs bg-black/20 p-3 rounded font-mono">{entry.rawTranscript}</pre>
        </details>
      )}

      {/* Audio metadata + retain */}
      {entry.audioPath && audioRetentionDays !== null && (
        <div className="glass rounded-xl px-4 py-3 text-xs flex items-center gap-2 text-muted-foreground">
          <Volume2 className="size-3.5" />
          {entry.audioDurationSec ? `${Math.floor(entry.audioDurationSec / 60)}m${(entry.audioDurationSec % 60).toString().padStart(2, "0")}s · ` : ""}
          {entry.audioRetainForever
            ? <>Audio se ponechává navždy. <button onClick={toggleRetain} className="underline">Smazat za 7 dní místo toho</button></>
            : <>Audio se smaže za {audioRetentionDays} {audioRetentionDays === 1 ? "den" : audioRetentionDays < 5 ? "dny" : "dní"}. <button onClick={toggleRetain} className="underline">Ponechat navždy</button></>
          }
        </div>
      )}
    </div>
  );
}
