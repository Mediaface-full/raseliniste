import { useState } from "react";
import { Loader2, Save, X, Plus, ChevronLeft, ChevronRight, Briefcase, Heart, Layers, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const STEPS = ["Název + kontext", "Otázka", "Varianty", "Předpoklady", "Termín", "Souhrn"];

export default function BwMysNew() {
  const [step, setStep] = useState(0);
  const [nazev, setNazev] = useState("");
  const [kontext, setKontext] = useState<"pracovni" | "osobni" | "smiseny">("osobni");
  const [otazka, setOtazka] = useState("");
  const [varianty, setVarianty] = useState<string[]>(["", "", ""]);
  const [predpoklady, setPredpoklady] = useState<string[]>([""]);
  const [deadlineDate, setDeadlineDate] = useState(() => {
    const d = new Date(Date.now() + 14 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [delkaSberuDny, setDelkaSberuDny] = useState(14);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function suggestVariants() {
    setErr(null);
    if (!otazka.trim().endsWith("?")) {
      setErr("Nejdřív zadej otázku (krok 2).");
      return;
    }
    const current = varianty.map((v) => v.trim()).filter(Boolean);
    if (current.length < 1) {
      setErr("Zadej aspoň 1 variantu, AI doplní další.");
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch("/api/bwmys/suggest-variants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otazka: otazka.trim(), soucasneVarianty: current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "AI návrh selhal.");
        return;
      }
      // Doplň AI varianty na konec, ponechej existující
      const combined = [...current, ...(data.varianty as string[])];
      setVarianty(combined);
    } finally {
      setSuggesting(false);
    }
  }

  function next() { setErr(null); setStep((s) => Math.min(STEPS.length - 1, s + 1)); }
  function back() { setErr(null); setStep((s) => Math.max(0, s - 1)); }

  function canNext(): boolean {
    if (step === 0) return nazev.trim().length > 0;
    if (step === 1) return otazka.trim().endsWith("?");
    if (step === 2) return varianty.filter((v) => v.trim().length > 0).length >= 3;
    if (step === 3) return predpoklady.filter((p) => p.trim().length > 0).length >= 1;
    if (step === 4) return new Date(deadlineDate) > new Date();
    return true;
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/bwmys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nazev: nazev.trim(),
          kontext,
          otazka: otazka.trim(),
          varianty: varianty.map((v) => v.trim()).filter(Boolean),
          predpoklady: predpoklady.map((p) => p.trim()).filter(Boolean),
          deadlineRozhodnuti: new Date(deadlineDate).toISOString(),
          delkaSberuDny,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Uložení selhalo.");
        return;
      }
      window.location.href = `/bwmys/${data.item.id}`;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* Step indikátor */}
      <div className="glass rounded-xl p-3 flex items-center gap-2 text-xs font-mono">
        <span className="text-muted-foreground">Krok {step + 1}/{STEPS.length}</span>
        <span className="text-foreground">{STEPS[step]}</span>
        <div className="ml-auto flex gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-6 rounded-full transition ${
                i <= step ? "bg-[var(--tint-sky)]" : "bg-white/10"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="glass-strong rounded-xl p-5 space-y-4 min-h-[280px]">
        {step === 0 && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Pracovní název pro orientaci
              </label>
              <Input value={nazev} onChange={(e) => setNazev(e.target.value)} placeholder={'např. „Rozjet podcast"'} autoFocus />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2 block">
                Kontext rozhodnutí
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "pracovni", label: "Pracovní", icon: Briefcase, tint: "sky" },
                  { v: "osobni", label: "Osobní", icon: Heart, tint: "rose" },
                  { v: "smiseny", label: "Smíšený", icon: Layers, tint: "lavender" },
                ].map((o) => {
                  const Icon = o.icon;
                  const active = kontext === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setKontext(o.v as typeof kontext)}
                      className={`rounded-lg p-3 border flex flex-col items-center gap-1 ${
                        active
                          ? `bg-[var(--tint-${o.tint})]/20 border-[var(--tint-${o.tint})]/60`
                          : "bg-background/30 border-border/40 hover:bg-white/5"
                      }`}
                    >
                      <Icon className="size-5" style={{ color: `var(--tint-${o.tint})` }} />
                      <span className="text-sm">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              Formulujte jako otázku (musí končit ?)
            </label>
            <textarea
              value={otazka}
              onChange={(e) => setOtazka(e.target.value)}
              rows={3}
              autoFocus
              placeholder='např. „Mám rozjet podcast jednou měsíčně?"'
              className="w-full px-3 py-2.5 rounded-md bg-background/40 border border-border/60 text-base resize-none"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Otázka má jasný subjekt (já), akci (rozjet) a obejekt (podcast). Bez „možná", „třeba", „asi".
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2 block">
              Varianty řešení (minimum 3)
            </label>
            <div className="space-y-2">
              {varianty.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <span className="font-mono text-xs text-muted-foreground self-center w-4">{i + 1}.</span>
                  <Input
                    value={v}
                    onChange={(e) => {
                      const next = [...varianty];
                      next[i] = e.target.value;
                      setVarianty(next);
                    }}
                    placeholder={i === 0 ? "Jdu do toho naplno" : i === 1 ? "Nechám být" : i === 2 ? "Menší verze (1× za 2 měsíce)" : ""}
                  />
                  {varianty.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setVarianty(varianty.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setVarianty([...varianty, ""])}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Plus className="size-3" /> přidat variantu
                </button>
                <button
                  type="button"
                  onClick={suggestVariants}
                  disabled={suggesting}
                  className="text-xs font-mono text-[var(--tint-lavender)] hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {suggesting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {suggesting ? "AI přemýšlí…" : "Navrhnout další (AI)"}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Tip: nemysli jen binárně (jdu/nejdu). Zkus odložení, menší verzi, delegování.
            </p>
          </div>
        )}

        {step === 3 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2 block">
              Předpoklady, na kterých rozhodnutí stojí (minimum 1)
            </label>
            <div className="space-y-2">
              {predpoklady.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <span className="font-mono text-xs text-muted-foreground self-center w-4">{i + 1}.</span>
                  <Input
                    value={p}
                    onChange={(e) => {
                      const next = [...predpoklady];
                      next[i] = e.target.value;
                      setPredpoklady(next);
                    }}
                    placeholder='např. „Budu mít čas natáčet 2 h týdně"'
                  />
                  {predpoklady.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPredpoklady(predpoklady.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPredpoklady([...predpoklady, ""])}
                className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <Plus className="size-3" /> přidat předpoklad
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Deadline rozhodnutí (do kdy musí být verdikt)
              </label>
              <Input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Délka sběru vstupů (dnů, default 14)
              </label>
              <Input
                type="number"
                min={1}
                max={180}
                value={delkaSberuDny}
                onChange={(e) => setDelkaSberuDny(parseInt(e.target.value, 10) || 14)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Po tomto čase ti aplikace navrhne zvážit finální vyhodnocení.
              </p>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</div>
              <div>{nazev}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Kontext</div>
              <div>{kontext}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Otázka</div>
              <div className="italic">{otazka}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Varianty</div>
              <ul className="list-disc pl-5 text-sm">
                {varianty.filter((v) => v.trim()).map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Předpoklady</div>
              <ul className="list-disc pl-5 text-sm">
                {predpoklady.filter((p) => p.trim()).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Deadline + sběr</div>
              <div>{deadlineDate} · sběr {delkaSberuDny} dní</div>
            </div>
          </div>
        )}
      </div>

      {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={back} disabled={step === 0}>
          <ChevronLeft /> Zpět
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={!canNext()} className="ml-auto">
            Dál <ChevronRight />
          </Button>
        ) : (
          <Button onClick={save} disabled={saving} className="ml-auto">
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Vytvořit rozhodnutí</>}
          </Button>
        )}
      </div>
    </div>
  );
}
