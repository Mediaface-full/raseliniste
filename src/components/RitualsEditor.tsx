import { useState } from "react";
import { Save, RotateCcw, Check } from "lucide-react";
import { Button } from "./ui/Button";

interface Props {
  initialMorning: string;
  initialFriday: string;
  initialSunday: string;
  defaultMorning: string;
  defaultFriday: string;
  defaultSunday: string;
}

export default function RitualsEditor(props: Props) {
  const [morning, setMorning] = useState(props.initialMorning);
  const [friday, setFriday] = useState(props.initialFriday);
  const [sunday, setSunday] = useState(props.initialSunday);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/rituals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          morning_day: morning.trim() || null,
          friday_reflection: friday.trim() || null,
          weekly_review: sunday.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <RitualSection
        tint="peach"
        title="Ranní pohled na den"
        when="Po-Pá 7:00–8:00"
        value={morning}
        defaultValue={props.defaultMorning}
        onChange={setMorning}
      />
      <RitualSection
        tint="peach"
        title="Páteční reflexe"
        when="Pá 17:00–17:15"
        value={friday}
        defaultValue={props.defaultFriday}
        onChange={setFriday}
      />
      <RitualSection
        tint="peach"
        title="Nedělní pohled na týden"
        when="Ne 18:00–18:15"
        value={sunday}
        defaultValue={props.defaultSunday}
        onChange={setSunday}
      />

      <div className="flex items-center gap-3 sticky bottom-3 bg-background/80 backdrop-blur-sm rounded-lg p-3 border border-white/10">
        <Button onClick={save} disabled={saving}>
          <Save /> {saving ? "Ukládám…" : "Uložit"}
        </Button>
        {savedAt && (
          <span className="text-xs font-mono text-[var(--tint-sage)] flex items-center gap-1">
            <Check className="size-3" /> Uloženo {new Date(savedAt).toLocaleTimeString("cs-CZ")}
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

function RitualSection({
  tint,
  title,
  when,
  value,
  defaultValue,
  onChange,
}: {
  tint: string;
  title: string;
  when: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
}) {
  const [showDefault, setShowDefault] = useState(false);
  return (
    <section
      className="glass rounded-xl p-4 space-y-3"
      style={{ ["--c" as string]: `var(--tint-${tint})` }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-serif text-xl" style={{ color: `color-mix(in oklch, var(--c) 95%, white)` }}>
            {title}
          </h2>
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mt-0.5">
            {when}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[10px] font-mono text-muted-foreground hover:text-destructive flex items-center gap-1"
              title="Vrátit na default text"
            >
              <RotateCcw className="size-3" /> resetovat
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDefault((v) => !v)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            {showDefault ? "skrýt default" : "zobrazit default"}
          </button>
        </div>
      </div>

      {showDefault && (
        <div className="rounded-md border border-white/[0.08] bg-black/20 p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground/80 leading-relaxed">
          {defaultValue}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        placeholder={`Prázdné = použije se default text. Klikni "zobrazit default" aby ses mrkl.\n\nPoužij Markdown: ## Nadpis, **tučně**, - odrážky.`}
        className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm font-mono leading-relaxed resize-y focus:border-primary focus:outline-none"
      />
    </section>
  );
}
