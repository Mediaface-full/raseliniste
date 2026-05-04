import { useState, useEffect } from "react";
import { Plus, Trash2, Save, X, Loader2, Edit3, Check, Pause, Play } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { DAY_NAMES_SHORT_CZ, formatRecurrence } from "@/lib/week-rituals";

interface CustomRitual {
  id: string;
  title: string;
  description: string | null;
  daysOfWeek: number[];
  startHour: number;
  startMinute: number;
  durationMin: number;
  active: boolean;
}

const RECURRENCE_PRESETS: { id: string; label: string; days: number[] }[] = [
  { id: "every_day", label: "Každý den", days: [0, 1, 2, 3, 4, 5, 6] },
  { id: "weekdays", label: "Pracovní dny (Po–Pá)", days: [0, 1, 2, 3, 4] },
  { id: "weekend", label: "Víkend (So–Ne)", days: [5, 6] },
  { id: "custom", label: "Vybrané dny", days: [] },
];

export default function CustomRitualsManager() {
  const [items, setItems] = useState<CustomRitual[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/rituals");
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    if (!confirm("Smazat tento rituál? Nelze vrátit zpět.")) return;
    const res = await fetch(`/api/rituals/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((r) => r.id !== id));
    }
  }

  async function toggleActive(r: CustomRitual) {
    const res = await fetch(`/api/rituals/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    if (res.ok) {
      const data = await res.json();
      setItems((prev) => prev.map((x) => (x.id === r.id ? data.ritual : x)));
    }
  }

  return (
    <section className="glass rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-serif text-xl">Vlastní rituály</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Nad rámec defaultních 3 (ranní / páteční / nedělní). Stejně se vykreslí v kalendáři, peach barva, dashed border.
          </p>
        </div>
        {editingId !== "new" && (
          <Button onClick={() => setEditingId("new")} variant="outline" size="sm">
            <Plus /> Přidat rituál
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {editingId === "new" && (
        <RitualForm
          onCancel={() => setEditingId(null)}
          onSaved={(r) => {
            setItems((prev) => [...prev, r]);
            setEditingId(null);
          }}
          onError={(m) => setError(m)}
        />
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Načítám…</div>
      ) : items.length === 0 && editingId !== "new" ? (
        <div className="text-sm text-muted-foreground italic py-4">
          Zatím žádné vlastní rituály. Klikni „Přidat rituál" výše.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((r) =>
            editingId === r.id ? (
              <li key={r.id}>
                <RitualForm
                  initial={r}
                  onCancel={() => setEditingId(null)}
                  onSaved={(updated) => {
                    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                    setEditingId(null);
                  }}
                  onError={(m) => setError(m)}
                />
              </li>
            ) : (
              <li
                key={r.id}
                className={`rounded-md border p-3 flex items-center gap-3 flex-wrap ${
                  r.active
                    ? "border-[var(--tint-peach)]/30 bg-[var(--tint-peach)]/[0.06]"
                    : "border-white/10 bg-white/[0.02] opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium" style={{ color: r.active ? "color-mix(in oklch, var(--tint-peach) 95%, white)" : undefined }}>
                    {r.title}
                  </div>
                  <div className="text-xs font-mono tabular text-muted-foreground mt-0.5">
                    {formatRecurrence(r.daysOfWeek)} ·{" "}
                    {String(r.startHour).padStart(2, "0")}:{String(r.startMinute).padStart(2, "0")}
                    {" "}–{" "}
                    {formatEnd(r.startHour, r.startMinute, r.durationMin)}
                    {" "}({r.durationMin} min)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  className="size-8 rounded-md hover:bg-white/5 grid place-items-center text-muted-foreground hover:text-foreground"
                  title={r.active ? "Pozastavit" : "Aktivovat"}
                >
                  {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="size-8 rounded-md hover:bg-white/5 grid place-items-center text-muted-foreground hover:text-foreground"
                  title="Upravit"
                >
                  <Edit3 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="size-8 rounded-md hover:bg-white/5 grid place-items-center text-muted-foreground hover:text-destructive"
                  title="Smazat"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}

function formatEnd(h: number, m: number, durMin: number): string {
  const total = h * 60 + m + durMin;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

function RitualForm({
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  initial?: CustomRitual;
  onCancel: () => void;
  onSaved: (r: CustomRitual) => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const initialPresetId = initial
    ? RECURRENCE_PRESETS.find(
        (p) =>
          p.id !== "custom" &&
          p.days.length === initial.daysOfWeek.length &&
          p.days.every((d) => initial.daysOfWeek.includes(d)),
      )?.id ?? "custom"
    : "weekdays";
  const [presetId, setPresetId] = useState<string>(initialPresetId);
  const [customDays, setCustomDays] = useState<number[]>(
    initial?.daysOfWeek ?? [],
  );
  const [startHour, setStartHour] = useState(initial?.startHour ?? 8);
  const [startMinute, setStartMinute] = useState(initial?.startMinute ?? 0);
  const [durationMin, setDurationMin] = useState(initial?.durationMin ?? 15);
  const [saving, setSaving] = useState(false);

  const daysToSave: number[] =
    presetId === "custom"
      ? customDays
      : RECURRENCE_PRESETS.find((p) => p.id === presetId)?.days ?? [];

  function toggleDay(d: number) {
    setCustomDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
    setPresetId("custom");
  }

  async function save() {
    if (!title.trim()) {
      onError("Vyplň název.");
      return;
    }
    if (daysToSave.length === 0) {
      onError("Vyber aspoň jeden den.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        daysOfWeek: daysToSave,
        startHour,
        startMinute,
        durationMin,
      };
      const res = initial
        ? await fetch(`/api/rituals/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/rituals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Uložení selhalo.");
        return;
      }
      onSaved(data.ritual);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--tint-peach)]/30 bg-[var(--tint-peach)]/[0.04] p-4 space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Název
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Např. „Krátký zápis do deníku"
          autoFocus
        />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Opakování
        </label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {RECURRENCE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                presetId === p.id
                  ? "bg-[var(--tint-peach)]/20 text-foreground"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {presetId === "custom" && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {DAY_NAMES_SHORT_CZ.map((name, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={`size-9 rounded-md text-xs font-mono transition-colors ${
                  customDays.includes(i)
                    ? "bg-[var(--tint-peach)]/30 text-foreground"
                    : "bg-white/5 text-muted-foreground hover:bg-white/10"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Začátek
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setStartHour(parseInt(e.target.value, 10) || 0)}
              className="w-14 px-2 py-1.5 rounded-md bg-background/40 border border-border/60 text-sm font-mono tabular text-center"
            />
            <span className="text-muted-foreground">:</span>
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              value={startMinute}
              onChange={(e) => setStartMinute(parseInt(e.target.value, 10) || 0)}
              className="w-14 px-2 py-1.5 rounded-md bg-background/40 border border-border/60 text-sm font-mono tabular text-center"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Délka (min)
          </label>
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={durationMin}
            onChange={(e) => setDurationMin(parseInt(e.target.value, 10) || 5)}
            className="w-full px-2 py-1.5 rounded-md bg-background/40 border border-border/60 text-sm font-mono tabular"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Konec
          </label>
          <div className="px-2 py-1.5 text-sm font-mono tabular text-muted-foreground">
            {formatEnd(startHour, startMinute, durationMin)}
          </div>
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Popis (markdown — co v rituálu dělat)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="## Krok 1&#10;..."
          className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm font-mono leading-relaxed resize-y"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving} size="sm">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {initial ? "Uložit" : "Přidat"}
        </Button>
        <Button onClick={onCancel} variant="ghost" size="sm">
          <X /> Zrušit
        </Button>
      </div>
    </div>
  );
}
