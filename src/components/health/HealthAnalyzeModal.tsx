import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bed,
  Download,
  Heart,
  HeartPulse,
  Loader2,
  Scale,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import { marked } from "marked";
import { Button } from "../ui/Button";

type AnalyzeResponse = {
  id: string;
  text: string;
  meta: {
    from: string;
    to: string;
    days: number;
    totalSamples: number;
    metricsWithData: number;
    model: string;
    promptChars: number;
  };
};

const FOCUS_PRESETS: { id: string; label: string; icon: typeof Activity; text: string }[] = [
  { id: "general", label: "Obecný přehled", icon: Stethoscope, text: "" },
  { id: "heart", label: "Srdce & HRV", icon: HeartPulse, text: "Zaměř se na kardiovaskulární metriky — klidový tep, HRV, dechovou frekvenci, cardio recovery. Hledej anomálie a trendy." },
  { id: "sleep", label: "Spánek", icon: Bed, text: "Zaměř se na kvalitu a kvantitu spánku. Jak se mění poměr hluboký / REM / core, celková délka, konzistence uléhání." },
  { id: "activity", label: "Aktivita", icon: Activity, text: "Zaměř se na pohybovou aktivitu — kroky, aktivní energii, cvičení, vzdálenost. Jsou týdny hodně rozdílné? Sedavé období?" },
  { id: "body", label: "Tělo & váha", icon: Scale, text: "Zaměř se na váhu, tělesný tuk a s tím spojené metriky. Trend, konzistence měření." },
  { id: "pressure", label: "Krevní tlak", icon: Heart, text: "Zaměř se na krevní tlak. Jsou hodnoty v normě? Jak se vyvíjí systolická i diastolická hodnota?" },
  { id: "warning", label: "Varovné signály", icon: Heart, text: "Hledej POUZE varovné signály — dlouhodobé odchylky od normy, trendy které naznačují problém (klidový tep rostoucí, HRV klesající, spánek krátnoucí, krevní tlak stoupající). Buď konkrétní." },
];

export default function HealthAnalyzeModal({
  open,
  onClose,
  onSaved,
  initialFrom,
  initialTo,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialFrom: Date;
  initialTo: Date;
}) {
  const [from, setFrom] = useState(initialFrom.toISOString().slice(0, 10));
  const [to, setTo] = useState(initialTo.toISOString().slice(0, 10));
  const [focusPreset, setFocusPreset] = useState<string>("general");
  const [focusText, setFocusText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFrom(initialFrom.toISOString().slice(0, 10));
    setTo(initialTo.toISOString().slice(0, 10));
  }, [initialFrom, initialTo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);

    // Body scroll lock — když je modal otevřený, stránka pod ním se nehýbe.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Backdrop scrollnout na začátek, aby uživatel viděl horní část modalu
    // (a ne náhodou konec, pokud byl předtím scrollnutý ve stránce).
    requestAnimationFrame(() => {
      backdropRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Po dokončení analýzy scrollnout backdrop k výsledku, ne aby se objevil zdánlivě mimo view.
  useEffect(() => {
    if (result && resultRef.current) {
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [result]);

  function selectPreset(id: string) {
    setFocusPreset(id);
    const p = FOCUS_PRESETS.find((x) => x.id === id);
    if (p) setFocusText(p.text);
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fromDate = new Date(from + "T00:00:00");
      const toDate = new Date(to + "T23:59:59");
      const res = await fetch("/api/health/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          focus: focusText.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Analýza selhala.");
        return;
      }
      onSaved?.();
      // Přesměrování na samostatnou stránku — modal je pro dlouhé reporty nepoužitelný.
      window.location.href = `/health/analyza/${data.id}`;
      return;
    } catch {
      setError("Síťová chyba.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  function downloadMarkdown() {
    if (!result) return;
    const header = `# Analýza zdravotních dat\n\n` +
      `- Období: **${from} → ${to}** (${result.meta.days} dní)\n` +
      `- Záznamů: ${result.meta.totalSamples.toLocaleString("cs-CZ")}\n` +
      `- Metrik s daty: ${result.meta.metricsWithData}\n` +
      `- Model: ${result.meta.model}\n` +
      `- Vygenerováno: ${new Date().toLocaleString("cs-CZ")}\n\n---\n\n`;
    const blob = new Blob([header + result.text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `health-${from}_${to}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-strong rounded-xl w-full max-w-3xl flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        {/* Header (sticky) */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="size-10 rounded-lg grid place-items-center"
              style={{
                background: "color-mix(in oklch, var(--tint-lavender) 18%, transparent)",
                color: "var(--tint-lavender)",
              }}
            >
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl">Analýza zdravotních dat</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Gemini se podívá na vývoj, trendy a případné anomálie.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zavřít">
            <X />
          </Button>
        </div>

        {/* Body — 2 části: konfigurace + výsledek (scrollable) */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* Date range */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
              Období analýzy
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={loading}
                className="bg-white/5 border border-border rounded-md px-3 py-1.5 text-foreground font-mono"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={loading}
                className="bg-white/5 border border-border rounded-md px-3 py-1.5 text-foreground font-mono"
              />
            </div>
          </div>

          {/* Focus preset */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
              Na co se zaměřit
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FOCUS_PRESETS.map((p) => {
                const Icon = p.icon;
                const active = focusPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p.id)}
                    disabled={loading}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                      active
                        ? "bg-white/15 text-foreground"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom focus text */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
              Vlastní pokyn (nepovinné)
            </div>
            <textarea
              value={focusText}
              onChange={(e) => setFocusText(e.target.value)}
              disabled={loading}
              placeholder="Např. 'Zajímá mě, jestli se mi po přidání cvičení změnil klidový tep.'"
              className="w-full min-h-[72px] rounded-md border border-border bg-input/40 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              maxLength={1000}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {/* Run / result */}
          {!result && (
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={runAnalysis} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" /> Analyzuji…
                  </>
                ) : (
                  <>
                    <Sparkles /> Spustit analýzu
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Pošleme agregovaná data (ne raw body) na Gemini Pro. Limit 10 analýz za 24 h.
              </span>
            </div>
          )}

          {result && (
            <div ref={resultRef} className="space-y-3 scroll-mt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
                  Výsledek
                </div>
                <div className="text-xs text-muted-foreground font-mono tabular flex items-center gap-3">
                  <span>{result.meta.days} dní</span>
                  <span>·</span>
                  <span>{result.meta.totalSamples.toLocaleString("cs-CZ")} záznamů</span>
                  <span>·</span>
                  <span>{result.meta.metricsWithData} metrik</span>
                  <span>·</span>
                  <span>{result.meta.model}</span>
                </div>
              </div>

              <div
                className="prose-rasel rounded-lg border border-white/10 bg-black/20 p-5 text-[15px] leading-relaxed"
                // dangerouslySetInnerHTML je bezpečné — Gemini výstup je řízený
                // naším system promptem a renderujeme ho jen přihlášenému uživateli.
                dangerouslySetInnerHTML={{ __html: marked.parse(result.text) as string }}
              />

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <Button variant="outline" size="sm" onClick={downloadMarkdown}>
                  <Download /> Stáhnout (.md)
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); }}>
                  Nová analýza
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>Zavřít</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
