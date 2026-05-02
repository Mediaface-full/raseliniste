import { useState } from "react";
import { Loader2, Play, RotateCw } from "lucide-react";

/**
 * Tlačítko „Spustit teď" v /settings/crons — manuální dispatch scheduleru
 * bez nutnosti SSH curlu. Po doběhu přesměruje na refresh stránky.
 */
export default function SchedulerRunButton() {
  const [busy, setBusy] = useState<"run" | "dryrun" | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dryrun" : "run");
    setErr(null);
    setResult(null);
    try {
      const url = `/api/cron/scheduler-run${dry ? "?dryRun=1" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Spuštění selhalo.");
        return;
      }
      setResult(data);
      // Auto-refresh stránky po reálném runu, ať se tabulka updatuje
      if (!dry) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(false)}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-md bg-[var(--tint-sage)]/15 border border-[var(--tint-sage)]/40 hover:bg-[var(--tint-sage)]/25 text-[var(--tint-sage)] text-sm font-medium flex items-center gap-1.5 transition disabled:opacity-50"
        >
          {busy === "run" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Spustit teď
        </button>
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 text-muted-foreground text-sm flex items-center gap-1.5 transition disabled:opacity-50"
          title="Vyhodnotí co BY se spustilo, ale nic neexecutuje"
        >
          {busy === "dryrun" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          Dry-run
        </button>
      </div>

      {err && (
        <div className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          {err}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {result.dryRun ? "Dry-run výsledek" : "Doběhlo"} · {result.durationMs} ms
          </div>
          <div>
            <strong>{result.jobsRan}</strong> spuštěno z <strong>{result.jobsMatched}</strong> match-ujících
            ({result.jobsTotal} celkem). {result.jobsFailed > 0 && (
              <span className="text-destructive font-mono">{result.jobsFailed} chyb</span>
            )}
          </div>
          {result.results.filter((r: { matched: boolean; ranNow: boolean }) => r.matched).length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted-foreground font-mono">Match detaily</summary>
              <ul className="mt-1.5 space-y-0.5 pl-2">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {result.results.filter((r: any) => r.matched).map((r: any) => (
                  <li key={r.name} className="font-mono text-[11px]">
                    <span className={r.ranNow ? (r.error ? "text-destructive" : "text-[var(--tint-sage)]") : "text-muted-foreground"}>
                      {r.ranNow ? (r.error ? "✗" : "✓") : "○"}
                    </span>{" "}
                    {r.name}
                    {r.skippedReason && <span className="text-muted-foreground"> — {r.skippedReason}</span>}
                    {r.status && <span className="text-muted-foreground"> · {r.status}</span>}
                    {r.durationMs && <span className="text-muted-foreground"> · {r.durationMs} ms</span>}
                    {r.error && <span className="text-destructive"> — {r.error}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!result.dryRun && (
            <div className="text-[10px] text-muted-foreground italic">
              Stránka se za chvíli refreshne…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
