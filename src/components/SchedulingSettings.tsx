import { useState } from "react";
import { Save, AlertTriangle, Check, Loader2, MapPin, Home, Video, Coffee, Clock, Gauge, Calendar } from "lucide-react";
import { Button } from "./ui/Button";

interface Config {
  pragueDays: number[];
  pragueHours: { start: string; end: string };
  homeDays: number[];
  homeHours: { start: string; end: string };
  onlineDays: number[];
  onlineHours: { start: string; end: string };
  lunchBreak: { start: string; end: string };
  endOfDay: string;
  bufferPragueMinutes: number;
  bufferOnlineBetweenMinutes: number;
  minLeadTimeClientHours: number;
  minLeadTimeFriendHours: number;
  maxBookingHorizonDays: number;
  maxPragueWarning: number;
  maxInPersonWarning: number;
  maxInPersonError: number;
  maxOnlineWarning: number;
  weightedLoadWarning: number;
  weightedLoadError: number;
}

// Po=1, Út=2, St=3, Čt=4, Pá=5, So=6, Ne=0
const WEEKDAYS: { label: string; value: number }[] = [
  { label: "Po", value: 1 },
  { label: "Út", value: 2 },
  { label: "St", value: 3 },
  { label: "Čt", value: 4 },
  { label: "Pá", value: 5 },
  { label: "So", value: 6 },
  { label: "Ne", value: 0 },
];

export default function SchedulingSettings({ initial }: { initial: Config }) {
  const [config, setConfig] = useState<Config>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleDay(field: "pragueDays" | "homeDays" | "onlineDays", day: number) {
    setConfig((c) => {
      const set = new Set(c[field]);
      set.has(day) ? set.delete(day) : set.add(day);
      return { ...c, [field]: Array.from(set).sort((a, b) => a - b) };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">Nastavení bookingu</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dostupnost pro pozvánky (<code className="text-xs">/calendar/invite</code>) a veřejnou stránku <code className="text-xs">/schuzka</code>.
          Změny se projeví okamžitě.
        </p>
      </div>

      {/* Online */}
      <Section icon={<Video className="size-4" />} title="Online schůzky" tint="sky">
        <DayPicker label="Dny" value={config.onlineDays} onToggle={(d) => toggleDay("onlineDays", d)} />
        <HoursPicker label="Hodiny" start={config.onlineHours.start} end={config.onlineHours.end}
          onChange={(start, end) => setConfig((c) => ({ ...c, onlineHours: { start, end } }))} />
      </Section>

      {/* Praha */}
      <Section icon={<MapPin className="size-4" />} title="Schůzky v Praze" tint="lavender">
        <DayPicker label="Dny" value={config.pragueDays} onToggle={(d) => toggleDay("pragueDays", d)} />
        <HoursPicker label="Hodiny" start={config.pragueHours.start} end={config.pragueHours.end}
          onChange={(start, end) => setConfig((c) => ({ ...c, pragueHours: { start, end } }))} />
      </Section>

      {/* Doma */}
      <Section icon={<Home className="size-4" />} title="Schůzky doma" tint="sage">
        <DayPicker label="Dny" value={config.homeDays} onToggle={(d) => toggleDay("homeDays", d)} />
        <HoursPicker label="Hodiny" start={config.homeHours.start} end={config.homeHours.end}
          onChange={(start, end) => setConfig((c) => ({ ...c, homeHours: { start, end } }))} />
      </Section>

      {/* Pauzy a denní okolnosti */}
      <Section icon={<Coffee className="size-4" />} title="Pauzy a konec dne" tint="butter">
        <HoursPicker label="Oběd (blokovaný)" start={config.lunchBreak.start} end={config.lunchBreak.end}
          onChange={(start, end) => setConfig((c) => ({ ...c, lunchBreak: { start, end } }))} />
        <Field label="Konec pracovního dne">
          <TimeInput value={config.endOfDay} onChange={(v) => setConfig((c) => ({ ...c, endOfDay: v }))} />
        </Field>
      </Section>

      {/* Lead time */}
      <Section icon={<Clock className="size-4" />} title="Lead time (předstih rezervace)" tint="peach">
        <Field label="Klient (hodin)" hint="Doporučeno 48–72">
          <NumberInput value={config.minLeadTimeClientHours} onChange={(v) => setConfig((c) => ({ ...c, minLeadTimeClientHours: v }))} min={0} max={720} />
        </Field>
        <Field label="Přítel (hodin)" hint="Doporučeno 12–24">
          <NumberInput value={config.minLeadTimeFriendHours} onChange={(v) => setConfig((c) => ({ ...c, minLeadTimeFriendHours: v }))} min={0} max={720} />
        </Field>
        <Field label="Horizont (dnů kupředu)" hint="Jak daleko může klient vybírat">
          <NumberInput value={config.maxBookingHorizonDays} onChange={(v) => setConfig((c) => ({ ...c, maxBookingHorizonDays: v }))} min={1} max={180} />
        </Field>
      </Section>

      {/* Buffery */}
      <Section icon={<Calendar className="size-4" />} title="Buffery (přestávky mezi)" tint="mint">
        <Field label="Před cestou do Prahy (min)" hint="Aby ses stihl přesunout">
          <NumberInput value={config.bufferPragueMinutes} onChange={(v) => setConfig((c) => ({ ...c, bufferPragueMinutes: v }))} min={0} max={480} />
        </Field>
        <Field label="Mezi online schůzkami (min)" hint="Doporučeno 15–30">
          <NumberInput value={config.bufferOnlineBetweenMinutes} onChange={(v) => setConfig((c) => ({ ...c, bufferOnlineBetweenMinutes: v }))} min={0} max={240} />
        </Field>
      </Section>

      {/* Denní limity (warning/error) */}
      <Section icon={<Gauge className="size-4" />} title="Denní limity (proti přebookování)" tint="rose">
        <p className="text-xs text-muted-foreground mb-2">
          Warning = žluté upozornění, error = červené (slot se nenabídne v bookingu).
        </p>
        <Field label="Max Praha / den (warning)">
          <NumberInput value={config.maxPragueWarning} onChange={(v) => setConfig((c) => ({ ...c, maxPragueWarning: v }))} min={0} max={20} />
        </Field>
        <Field label="Max prezenčních / den (warning)">
          <NumberInput value={config.maxInPersonWarning} onChange={(v) => setConfig((c) => ({ ...c, maxInPersonWarning: v }))} min={0} max={20} />
        </Field>
        <Field label="Max prezenčních / den (error)" hint="Tvrdá hranice — booking nedovolí">
          <NumberInput value={config.maxInPersonError} onChange={(v) => setConfig((c) => ({ ...c, maxInPersonError: v }))} min={0} max={20} />
        </Field>
        <Field label="Max online / den (warning)">
          <NumberInput value={config.maxOnlineWarning} onChange={(v) => setConfig((c) => ({ ...c, maxOnlineWarning: v }))} min={0} max={20} />
        </Field>
        <Field label="Hybridní zátěž (warning)" hint="Prezenční=1.0, online=0.6. Sčítá se přes den.">
          <NumberInput value={config.weightedLoadWarning} step={0.1} onChange={(v) => setConfig((c) => ({ ...c, weightedLoadWarning: v }))} min={0} max={20} />
        </Field>
        <Field label="Hybridní zátěž (error)">
          <NumberInput value={config.weightedLoadError} step={0.1} onChange={(v) => setConfig((c) => ({ ...c, weightedLoadError: v }))} min={0} max={20} />
        </Field>
      </Section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="flex items-center gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Uložit
        </Button>
        {savedAt && (
          <span className="text-sm text-[var(--tint-sage)] flex items-center gap-1">
            <Check className="size-4" /> Uloženo
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Subcomponents ------------------------------------------------------

function Section({ icon, title, tint, children }: { icon: React.ReactNode; title: string; tint: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: `var(--tint-${tint})` }}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span style={{ color: `var(--tint-${tint})` }}>{icon}</span>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DayPicker({ label, value, onToggle }: { label: string; value: number[]; onToggle: (d: number) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-1.5 flex-wrap">
        {WEEKDAYS.map((d) => {
          const active = value.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => onToggle(d.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-mono transition border ${
                active
                  ? "border-[var(--c)] bg-[var(--c)]/15 text-foreground"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function HoursPicker({ label, start, end, onChange }: { label: string; start: string; end: string; onChange: (start: string, end: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <TimeInput value={start} onChange={(v) => onChange(v, end)} />
        <span className="text-muted-foreground">–</span>
        <TimeInput value={end} onChange={(v) => onChange(start, v)} />
      </div>
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-mono uppercase text-muted-foreground tracking-wider">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm font-mono w-28"
    />
  );
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const v = step && step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (!Number.isNaN(v)) onChange(v);
      }}
      min={min}
      max={max}
      step={step ?? 1}
      className="w-24 px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm font-mono"
    />
  );
}
