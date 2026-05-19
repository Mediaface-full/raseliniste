import { useState } from "react";
import { Plane, Laptop, Plus, Loader2, Check, AlertTriangle, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface OooEvent {
  id: string;
  title: string;
  type: "OOO_FULL" | "OOO_TRAVEL_WORKING";
  startsAt: string;
  endsAt: string;
  sourceUrl: string | null;
}

export default function AwayManager({ initial }: { initial: OooEvent[] }) {
  const [events, setEvents] = useState<OooEvent[]>(initial);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"FULL" | "TRAVEL_WORKING">("FULL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Petr 2026-05-19: edit + delete existujících OOO období přímo v Rašeliništi
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFromDate, setEditFromDate] = useState("");
  const [editToDate, setEditToDate] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editMode, setEditMode] = useState<"FULL" | "TRAVEL_WORKING">("FULL");

  function startEdit(e: OooEvent) {
    setEditingId(e.id);
    const start = new Date(e.startsAt);
    const end = new Date(e.endsAt);
    // endsAt v DB je exclusive (next day 00:00). Pro UI date input chceme inkluzivní poslední den.
    const inclusiveEnd = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    setEditFromDate(start.toISOString().slice(0, 10));
    setEditToDate(inclusiveEnd.toISOString().slice(0, 10));
    // Strip prefix emoji + "NOMÁD: " pro editaci čistého názvu
    const rawTitle = e.title
      .replace(/^🌴\s*/, "")
      .replace(/^💻\s*NOMÁD:\s*/, "")
      .trim();
    setEditTitle(rawTitle);
    setEditMode(e.type === "OOO_FULL" ? "FULL" : "TRAVEL_WORKING");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditFromDate("");
    setEditToDate("");
    setEditTitle("");
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/calendar/away/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromDate: editFromDate,
          toDate: editToDate,
          mode: editMode,
          title: editTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Úprava selhala.");
        return;
      }
      setSuccess("✓ Upraveno (Google + Rašeliniště).");
      cancelEdit();
      const refreshRes = await fetch("/api/calendar/away");
      if (refreshRes.ok) {
        const fresh = await refreshRes.json();
        setEvents(fresh.events);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Opravdu smazat „${title}" z Google Calendaru?`)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/calendar/away/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Smazání selhalo.");
        return;
      }
      setSuccess("✓ Smazáno.");
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/calendar/away", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromDate, toDate, mode, title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Nepodařilo se vytvořit.");
        return;
      }
      setSuccess("✓ Vytvořeno v Google. Sync à 5 min stáhne k nám.");
      setFromDate("");
      setToDate("");
      setTitle("");
      // Refresh — events budou viditelné po sync
      const refreshRes = await fetch("/api/calendar/away");
      if (refreshRes.ok) {
        const fresh = await refreshRes.json();
        setEvents(fresh.events);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">Dovolená a nomád</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vyblokuj období, ve kterém nechceš schůzky. Synchronizuje se s Google Calendar a klienti to pak v bookingu nevidí.
        </p>
      </div>

      <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-butter)" }}>
        <h2 className="font-serif text-lg">Nové období</h2>

        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground mb-2 block">Režim</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("FULL")}
              className={`rounded-lg border p-3 text-left transition ${
                mode === "FULL"
                  ? "border-[var(--tint-rose)] bg-[var(--tint-rose)]/10"
                  : "border-white/10 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2 mb-1"><Plane className="size-4 text-[var(--tint-rose)]" /> <strong>Dovolená</strong></div>
              <div className="text-xs text-muted-foreground">Fakt pryč. Vyblokuje VŠE — i online.</div>
            </button>
            <button
              type="button"
              onClick={() => setMode("TRAVEL_WORKING")}
              className={`rounded-lg border p-3 text-left transition ${
                mode === "TRAVEL_WORKING"
                  ? "border-[var(--tint-mint)] bg-[var(--tint-mint)]/10"
                  : "border-white/10 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2 mb-1"><Laptop className="size-4 text-[var(--tint-mint)]" /> <strong>Nomád</strong></div>
              <div className="text-xs text-muted-foreground">Mimo, ale pracuju. Online OK, prezenční ne.</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Od (včetně)</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-mono uppercase text-muted-foreground">Do (včetně)</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">Název (volitelně)</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "FULL" ? "Itálie, Hory s rodinou…" : "Lisabon týden, Brno k rodičům…"}
          />
        </div>

        <Button onClick={create} disabled={busy || !fromDate || !toDate}>
          {busy ? <><Loader2 className="animate-spin" /> Vytvářím…</> : <><Plus /> Vytvořit</>}
        </Button>

        {success && (
          <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
            <Check className="size-4" /> {success}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
      </div>

      <div className="glass rounded-xl p-5">
        <h2 className="font-serif text-lg mb-3">Aktivní a budoucí období</h2>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Žádné OOO období v plánu.</div>
        ) : (
          <div className="space-y-2">
            {events.map((e) => {
              const start = new Date(e.startsAt);
              const end = new Date(e.endsAt);
              const isFull = e.type === "OOO_FULL";
              const isEditing = editingId === e.id;

              if (isEditing) {
                return (
                  <div key={e.id} className="rounded-md p-3 bg-black/30 border border-[var(--tint-butter)]/40 space-y-3">
                    <div className="text-xs font-mono uppercase text-[var(--tint-butter)]">Úprava</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setEditMode("FULL")}
                        className={`rounded-md border p-2 text-xs text-left transition ${editMode === "FULL" ? "border-[var(--tint-rose)] bg-[var(--tint-rose)]/10" : "border-white/10 hover:bg-white/5"}`}
                      >
                        <Plane className="size-3 inline text-[var(--tint-rose)]" /> Dovolená
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditMode("TRAVEL_WORKING")}
                        className={`rounded-md border p-2 text-xs text-left transition ${editMode === "TRAVEL_WORKING" ? "border-[var(--tint-mint)] bg-[var(--tint-mint)]/10" : "border-white/10 hover:bg-white/5"}`}
                      >
                        <Laptop className="size-3 inline text-[var(--tint-mint)]" /> Nomád
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="date" value={editFromDate} onChange={(ev) => setEditFromDate(ev.target.value)} />
                      <Input type="date" value={editToDate} onChange={(ev) => setEditToDate(ev.target.value)} />
                    </div>
                    <Input value={editTitle} onChange={(ev) => setEditTitle(ev.target.value)} placeholder="Název (volitelně)" />
                    <div className="flex gap-2">
                      <Button onClick={() => saveEdit(e.id)} disabled={busy || !editFromDate || !editToDate} size="sm">
                        {busy ? <Loader2 className="animate-spin size-4" /> : <Check className="size-4" />} Uložit
                      </Button>
                      <Button onClick={cancelEdit} variant="outline" size="sm">
                        <X className="size-4" /> Zrušit
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-md p-3 bg-black/15 border border-white/5"
                >
                  {isFull ? <Plane className="size-4 text-[var(--tint-rose)]" /> : <Laptop className="size-4 text-[var(--tint-mint)]" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{e.title}</div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {start.toLocaleDateString("cs-CZ")} – {new Date(end.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString("cs-CZ")}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    {isFull ? "FULL" : "NOMÁD"}
                  </span>
                  <button
                    onClick={() => startEdit(e)}
                    disabled={busy}
                    className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
                    title="Upravit"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => remove(e.id, e.title)}
                    disabled={busy}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                    title="Smazat z Google Calendar"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  {e.sourceUrl && (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Otevřít v Google Calendar">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Edituj nebo maž tlačítky vpravo — změny se propíšou do Google Calendaru ihned.
        </p>
      </div>
    </div>
  );
}
