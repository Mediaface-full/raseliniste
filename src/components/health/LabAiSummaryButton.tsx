import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";

/**
 * AI shrnutí vývoje krevních výsledků (Petr 2026-07-21). Reuse existující
 * pipeline HealthAnalysis: POST /api/health/analyze s krevním focusem —
 * labSummaryForAnalysis už krevní hodnoty do promptu dává. Po startu redirect
 * na /health/analyza/{id} (poll + render tam, stejně jako běžná analýza).
 */
export default function LabAiSummaryButton({ firstSampleIso }: { firstSampleIso: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      // Období: od prvního odběru (max 400 dní zpět — limit endpointu) do dneška
      const to = new Date();
      const minFrom = new Date(to.getTime() - 399 * 86_400_000);
      let from = firstSampleIso ? new Date(firstSampleIso) : minFrom;
      if (from < minFrom) from = minFrom;
      const res = await fetch("/api/health/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: from.toISOString(),
          to: to.toISOString(),
          focus:
            "Zaměř se především na LABORATORNÍ KREVNÍ VÝSLEDKY (sekce Laboratorní výsledky): " +
            "vývoj hodnot mezi odběry, hodnoty mimo referenční rozmezí a co s nimi, " +
            "souvislosti s ostatními metrikami (váha, tlak, spánek, aktivita). " +
            "Struktura: 1) shrnutí, 2) hodnoty mimo normu a trend, 3) doporučení k probrání s lékařem.",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Analýza selhala.");
        return;
      }
      window.location.href = `/health/analyza/${data.id}`;
    } catch {
      setError("Síťová chyba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button onClick={run} disabled={busy} variant="outline">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Shrnout vývoj (AI)
      </Button>
      <span className="text-xs text-muted-foreground">
        Gemini Pro projde krevní hodnoty i ostatní metriky — trvá ~1 min, otevře se stránka analýzy.
      </span>
      {error && <span className="text-sm text-[var(--destructive,#e5484d)]">{error}</span>}
    </div>
  );
}
