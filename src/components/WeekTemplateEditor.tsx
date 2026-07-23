import { useState } from "react";
import { ChevronRight, ChevronDown, Loader2, Check } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * Editor šablony týdne (theme days, ADHD F3). Sbalený řádek nad boardem —
 * po rozkliku 7 dnů × režim + volitelný popisek. Uloží se celá šablona.
 */

type Mode = "manager" | "maker" | "own" | "off";

const MODES: { id: Mode; name: string; tint: string; hint: string }[] = [
  { id: "manager", name: "Manager", tint: "sky",    hint: "schůzky, hovory, admin" },
  { id: "maker",   name: "Maker",   tint: "peach",  hint: "deep work — klienti" },
  { id: "own",     name: "Vlastní", tint: "butter", hint: "vlastní projekty" },
  { id: "off",     name: "Volno",   tint: "sage",   hint: "neplánovat" },
];
const DAY_NAMES = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];

export interface TemplateDayInput { weekday: number; mode: Mode; label: string | null }

export default function WeekTemplateEditor({ initialDays }: { initialDays: TemplateDayInput[] }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<TemplateDayInput[]>(() =>
    Array.from({ length: 7 }, (_, i) =>
      initialDays.find((d) => d.weekday === i) ?? { weekday: i, mode: i >= 5 ? "off" : "manager", label: null },
    ),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDay(i: number, patch: Partial<TemplateDayInput>) {
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/planovani/sablona", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) { setError("Uložení se nepovedlo."); return; }
      setSaved(true);
      // Board badge se čte SSR — reload ať se propíše
      setTimeout(() => window.location.reload(), 400);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-subtle rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left"
      >
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <span className="font-medium">Šablona týdne</span>
        <span className="text-xs text-muted-foreground">
          — manager / maker / vlastní dny; řídí AI plánování a hlídá schůzky
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {days.map((d, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <span className="w-20 text-sm">{DAY_NAMES[i]}</span>
              <div className="flex gap-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDay(i, { mode: m.id })}
                    title={m.hint}
                    className={`px-2 py-1 rounded-md text-xs font-mono border transition-colors ${
                      d.mode === m.id
                        ? "border-transparent text-background font-semibold"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    style={d.mode === m.id ? { background: `var(--tint-${m.tint})`, color: "var(--background)" } : undefined}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <input
                value={d.label ?? ""}
                onChange={(e) => setDay(i, { label: e.target.value || null })}
                placeholder="popisek (Radys, StoryMapa…)"
                className="flex-1 min-w-[8rem] rounded-md border border-border bg-card px-2 py-1 text-xs"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
              Uložit šablonu
            </Button>
            {error && <span className="text-sm text-[var(--destructive,#e5484d)]">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
