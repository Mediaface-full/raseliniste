import { useState } from "react";
import { Loader2, Heart } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type CheckInType = "lunch" | "evening";

export default function CheckInForm({ defaultType }: { defaultType: CheckInType }) {
  const [type] = useState<CheckInType>(defaultType);

  // Tělo
  const [lastMeal, setLastMeal] = useState("");
  const [mealUnknown, setMealUnknown] = useState(false);
  const [lastWater, setLastWater] = useState("");
  const [waterUnknown, setWaterUnknown] = useState(false);
  const [bodyFeeling, setBodyFeeling] = useState("");

  // Mysl
  const [mood, setMood] = useState<number | null>(null);
  const [whatWorked, setWhatWorked] = useState("");

  // Vztahy
  const [contacts, setContacts] = useState("");
  const [oldPattern, setOldPattern] = useState("");

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        type,
        lastMealAt: mealUnknown ? null : (lastMeal || null),
        lastWaterAt: waterUnknown ? null : (lastWater || null),
        bodyFeeling: bodyFeeling.trim() || null,
        mood,
        whatWorked: whatWorked.trim() || null,
        contacts: contacts.trim() || null,
        oldPattern: oldPattern.trim() || null,
      };
      const res = await fetch("/api/zijes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Uložení selhalo.");
        return;
      }
      setDone(true);
      // Po krátké pauze redirect na archiv
      setTimeout(() => {
        window.location.href = "/zijes";
      }, 1800);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="glass-strong rounded-xl p-8 text-center space-y-3">
        <Heart className="size-12 mx-auto text-[var(--tint-rose)]" />
        <div className="text-xl font-serif">Uloženo.</div>
        <div className="text-sm text-muted-foreground">
          Vrátíš se k tomu, jak budeš chtít.
        </div>
      </div>
    );
  }

  const typeLabel = type === "lunch" ? "Polední" : "Večerní";
  const now = new Date();
  const dateStr = now.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
  const timeStr = now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Hlavička */}
      <div className="text-center space-y-1">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--tint-rose)] font-mono">
          {typeLabel} check-in
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {dateStr} · {timeStr}
        </div>
      </div>

      {/* BLOK 1 — TĚLO */}
      <Block title="Tělo">
        <Field label="Kdy jsi naposledy jedl?">
          <div className="flex items-center gap-3">
            <Input
              type="time"
              value={lastMeal}
              onChange={(e) => { setLastMeal(e.target.value); setMealUnknown(false); }}
              disabled={mealUnknown}
              className="font-mono w-32"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={mealUnknown} onChange={(e) => setMealUnknown(e.target.checked)} className="size-4" />
              nepamatuju si
            </label>
          </div>
        </Field>

        <Field label="Kdy jsi naposledy pil vodu?">
          <div className="flex items-center gap-3">
            <Input
              type="time"
              value={lastWater}
              onChange={(e) => { setLastWater(e.target.value); setWaterUnknown(false); }}
              disabled={waterUnknown}
              className="font-mono w-32"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={waterUnknown} onChange={(e) => setWaterUnknown(e.target.checked)} className="size-4" />
              nepamatuju si
            </label>
          </div>
        </Field>

        <Field label="Co cítím v těle?">
          <Input
            value={bodyFeeling}
            onChange={(e) => setBodyFeeling(e.target.value)}
            placeholder='např. „napjatá ramena", „pálí žaludek", „nic, prázdno", „nevím"'
          />
        </Field>
      </Block>

      {/* BLOK 2 — MYSL */}
      <Block title="Mysl">
        <Field label="Nálada teď">
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
              <span>1 nejhorší</span>
              <span className="text-2xl font-mono text-foreground tabular-nums">{mood ?? "—"}</span>
              <span>10 nejlepší</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={mood ?? 5}
              onChange={(e) => setMood(parseInt(e.target.value, 10))}
              onTouchStart={() => mood === null && setMood(5)}
              onMouseDown={() => mood === null && setMood(5)}
              className="w-full accent-[var(--tint-rose)]"
            />
          </div>
        </Field>

        <Field label="Co mi dnes vyšlo?">
          <Input
            value={whatWorked}
            onChange={(e) => setWhatWorked(e.target.value)}
            placeholder='krátký text, nebo „nic"'
          />
        </Field>
      </Block>

      {/* BLOK 3 — VZTAHY A VZORCE */}
      <Block title="Vztahy a vzorce">
        <Field label="Mluvil jsem dnes s někým mně blízkým? S kým?">
          <Input
            value={contacts}
            onChange={(e) => setContacts(e.target.value)}
            placeholder='jména, nebo „ne"'
          />
        </Field>

        <Field label="Reagoval jsem dnes starým vzorcem? Na co?">
          <Input
            value={oldPattern}
            onChange={(e) => setOldPattern(e.target.value)}
            placeholder='krátký text, nebo „ne"'
          />
        </Field>
      </Block>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>
      )}

      <div className="sticky bottom-4 glass-strong rounded-xl p-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground flex-1">
          Nemusíš vyplnit všechno. Co necháš prázdné, zůstane prázdné.
        </span>
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <>Uložit</>}
        </Button>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-foreground/90 block">{label}</label>
      {children}
    </div>
  );
}
