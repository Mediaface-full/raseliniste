import { useState, useEffect } from "react";
import { Mic, Plus, Loader2, Calendar } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Mood = "ELATED" | "CONTENT" | "NEUTRAL" | "TIRED" | "STRESSED" | "DOWN" | "ANGRY" | "MIXED";

interface Entry {
  id: string;
  date: string;
  createdAt: string;
  title: string | null;
  bodyMarkdown: string;
  mood: Mood | null;
  tags: string[];
  highlights: string[];
  status: string;
  audioPath: string | null;
}

const MOOD_EMOJI: Record<Mood, string> = {
  ELATED: "🌟", CONTENT: "🙂", NEUTRAL: "😐", TIRED: "😴",
  STRESSED: "😰", DOWN: "😔", ANGRY: "😠", MIXED: "🌗",
};

export default function DenikList() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newBody, setNewBody] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/denik");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createManual() {
    if (!newBody.trim()) return;
    const res = await fetch("/api/denik", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: newDate, bodyMarkdown: newBody }),
    });
    if (res.ok) {
      setCreating(false);
      setNewBody("");
      void load();
    }
  }

  // Group entries by date
  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.date.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(e);
  }
  const days = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <a href="/diktat">
          <Button><Mic /> Nadiktovat zápis</Button>
        </a>
        <Button variant="outline" onClick={() => setCreating(!creating)}>
          <Plus /> Textový zápis
        </Button>
      </div>

      {creating && (
        <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="px-3 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
            />
          </div>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={6}
            placeholder="Co se dnes stalo? Jaké to bylo?"
            autoFocus
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={createManual} disabled={!newBody.trim()}>Uložit</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>Zrušit</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="glass rounded-xl p-6 text-center"><Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : days.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          Zatím žádné zápisy. Diktuj nebo napiš něco — tady se to objeví.
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(([day, dayEntries]) => {
            const dateObj = new Date(`${day}T00:00:00`);
            const label = dateObj.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
            return (
              <div key={day}>
                <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2">{label}</div>
                <div className="space-y-2">
                  {dayEntries.map((e) => (
                    <a
                      key={e.id}
                      href={`/denik/${e.id}/edit`}
                      className="glass rounded-xl p-4 block hover:bg-white/5 transition"
                    >
                      <div className="flex items-start gap-2">
                        {e.mood && <span className="text-xl shrink-0">{MOOD_EMOJI[e.mood]}</span>}
                        <div className="flex-1 min-w-0">
                          {e.title && <div className="font-serif text-base">{e.title}</div>}
                          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {e.bodyMarkdown.slice(0, 200)}
                          </div>
                          {e.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {e.tags.slice(0, 6).map((t) => (
                                <span key={t} className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                          {e.status === "processing" && (
                            <div className="text-xs text-[var(--tint-butter)] mt-2">⏳ AI strukturuje…</div>
                          )}
                          {e.audioPath && (
                            <div className="text-xs text-muted-foreground mt-1">🎤 audio</div>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
