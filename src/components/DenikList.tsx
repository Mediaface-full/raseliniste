import { useState, useEffect, useRef } from "react";
import { Mic, Plus, Loader2, Calendar, Search, X, Users, Tag, BookOpen, ChevronDown } from "lucide-react";
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
  people: string[];
  highlights: string[];
  status: string;
  audioPath: string | null;
}

interface Facets {
  tags: Array<{ tag: string; count: number }>;
  people: Array<{ person: string; count: number }>;
}

const MOOD_EMOJI: Record<Mood, string> = {
  ELATED: "🌟", CONTENT: "🙂", NEUTRAL: "😐", TIRED: "😴",
  STRESSED: "😰", DOWN: "😔", ANGRY: "😠", MIXED: "🌗",
};

export default function DenikList() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [facets, setFacets] = useState<Facets>({ tags: [], people: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newBody, setNewBody] = useState("");

  // Search/filter state
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  // Re-load on filter change (debounced search)
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tagFilter, personFilter, from, to]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (tagFilter) params.set("tag", tagFilter);
      if (personFilter) params.set("person", personFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = (q || tagFilter || personFilter || from || to)
        ? `/api/denik/search?${params}`
        : "/api/denik";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
        if (data.facets) setFacets(data.facets);
        else {
          // /api/denik nepošle facets, agreguj z entries
          const tagCounts = new Map<string, number>();
          const peopleCounts = new Map<string, number>();
          for (const e of data.entries as Entry[]) {
            for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
            for (const p of e.people ?? []) peopleCounts.set(p, (peopleCounts.get(p) ?? 0) + 1);
          }
          setFacets({
            tags: Array.from(tagCounts.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 20),
            people: Array.from(peopleCounts.entries()).map(([person, count]) => ({ person, count })).sort((a, b) => b.count - a.count).slice(0, 20),
          });
        }
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

  function clearAllFilters() {
    setQ("");
    setTagFilter(null);
    setPersonFilter(null);
    setFrom("");
    setTo("");
  }

  const hasFilter = Boolean(q || tagFilter || personFilter || from || to);

  // Group entries by date
  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = e.date.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(e);
  }
  const days = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  // Měsíční review odkazy — vezmi unikátní YYYY-MM z entries, top 6
  const monthsSet = new Set(entries.map((e) => e.date.slice(0, 7)));
  const months = Array.from(monthsSet).sort().reverse().slice(0, 6);

  // Petr 2026-05-27: nahrávat audio přímo z /denik bez redirectu (mobile
  // Safari blokuje programmatic click po navigaci). Stejný pattern jako
  // v UkolyList.
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function uploadAudioFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("durationSec", "0");
      const res = await fetch("/api/denik/audio", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.entryId) {
        setUploadError(data.error ?? `Upload selhal (HTTP ${res.status}).`);
        return;
      }
      // Po uploadu redirect na detail zápisu (poll status)
      window.location.href = `/denik/${data.entryId}`;
    } catch (e) {
      setUploadError(`Upload selhal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <a href="/ozvena?mode=journal">
          <Button><Mic /> Nadiktovat zápis</Button>
        </a>
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*,video/mp4,.m4a,.mp3,.opus,.ogg,.wav,.webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadAudioFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          disabled={uploading}
          onClick={() => audioFileInputRef.current?.click()}
        >
          {uploading ? <><Loader2 className="animate-spin" /> Nahrávám…</> : <>📎 Nahrát soubor</>}
        </Button>
        <Button variant="outline" onClick={() => setCreating(!creating)}>
          <Plus /> Textový zápis
        </Button>
        {months.length > 0 && (
          <div className="ml-auto relative">
            <details className="group">
              <summary className="list-none cursor-pointer">
                <Button variant="outline" size="sm">
                  <BookOpen /> Měsíční review <ChevronDown className="size-3" />
                </Button>
              </summary>
              <div className="absolute right-0 top-full mt-1 glass-strong rounded-md p-2 min-w-[180px] z-10">
                {months.map((ym) => {
                  const [y, m] = ym.split("-");
                  const monthName = new Date(parseInt(y), parseInt(m) - 1, 1)
                    .toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
                  return (
                    <a
                      key={ym}
                      href={`/denik/review/${ym}`}
                      className="block px-3 py-1.5 text-sm hover:bg-white/10 rounded"
                    >
                      {monthName}
                    </a>
                  );
                })}
              </div>
            </details>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="rounded-lg border-2 border-destructive/60 bg-destructive/15 text-sm px-3 py-2 flex items-start gap-2">
          <X className="size-4 shrink-0 mt-0.5 text-destructive" />
          <div className="flex-1">
            <strong className="text-destructive">Nahrání selhalo</strong>
            <div className="mt-0.5">{uploadError}</div>
          </div>
          <button onClick={() => setUploadError(null)} className="text-muted-foreground"><X className="size-4" /></button>
        </div>
      )}

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

      {/* Search bar */}
      <div className="glass rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat v textu zápisu (fulltext)…"
            className="flex-1 border-0 bg-transparent focus:ring-0"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-xs font-mono px-2 py-1 rounded ${showFilters ? "bg-foreground text-background" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
          >
            Filtry {hasFilter && "•"}
          </button>
          {hasFilter && (
            <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Od"
                className="px-3 py-1.5 rounded-md bg-black/30 border border-white/10"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Do"
                className="px-3 py-1.5 rounded-md bg-black/30 border border-white/10"
              />
            </div>
            {facets.people.length > 0 && (
              <div>
                <div className="text-xs uppercase font-mono text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Users className="size-3" /> Lidé
                </div>
                <div className="flex flex-wrap gap-1">
                  {facets.people.slice(0, 12).map((p) => (
                    <button
                      key={p.person}
                      onClick={() => setPersonFilter(personFilter === p.person ? null : p.person)}
                      className={`text-xs font-mono px-2 py-0.5 rounded ${personFilter === p.person ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"}`}
                    >
                      {p.person} <span className="opacity-50">{p.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {facets.tags.length > 0 && (
              <div>
                <div className="text-xs uppercase font-mono text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Tag className="size-3" /> Témata
                </div>
                <div className="flex flex-wrap gap-1">
                  {facets.tags.slice(0, 12).map((t) => (
                    <button
                      key={t.tag}
                      onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                      className={`text-xs font-mono px-2 py-0.5 rounded ${tagFilter === t.tag ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"}`}
                    >
                      #{t.tag} <span className="opacity-50">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="glass rounded-xl p-6 text-center"><Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : days.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          {hasFilter ? "Žádné zápisy nesedí na filtr." : "Zatím žádné zápisy. Diktuj nebo napiš něco — tady se to objeví."}
        </div>
      ) : (
        <div className="space-y-4">
          {hasFilter && (
            <div className="text-xs font-mono text-muted-foreground">
              Nalezeno {entries.length} zápisů
            </div>
          )}
          {days.map(([day, dayEntries]) => {
            const dateObj = new Date(`${day}T00:00:00`);
            const label = dateObj.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
            const fileLabel = `denik_${day}`;
            return (
              <div key={day}>
                <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2 flex items-center gap-2">
                  <span>{label}</span>
                  <span className="text-[10px] opacity-60">{fileLabel}</span>
                </div>
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
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
                            {e.people && e.people.length > 0 && (
                              <span className="flex items-center gap-1 text-[var(--tint-lavender)]">
                                <Users className="size-3" />
                                {e.people.slice(0, 4).join(", ")}{e.people.length > 4 ? `+${e.people.length - 4}` : ""}
                              </span>
                            )}
                            {e.tags.length > 0 && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Tag className="size-3" />
                                {e.tags.slice(0, 4).map((t) => `#${t}`).join(" ")}
                                {e.tags.length > 4 && ` +${e.tags.length - 4}`}
                              </span>
                            )}
                            {e.status === "processing" && (
                              <span className="text-[var(--tint-butter)]">⏳ AI strukturuje…</span>
                            )}
                            {e.audioPath && <span className="text-muted-foreground">🎤 audio</span>}
                          </div>
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
