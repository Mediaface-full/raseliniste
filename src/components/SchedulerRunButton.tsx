import { useState } from "react";
import { Loader2, Play, RotateCw, RefreshCcw, Trash2 } from "lucide-react";

/**
 * Tlačítko „Spustit teď" v /settings/crons — manuální dispatch scheduleru
 * bez nutnosti SSH curlu. Po doběhu přesměruje na refresh stránky.
 */
export default function SchedulerRunButton() {
  const [busy, setBusy] = useState<"run" | "dryrun" | "reset" | "hardreset" | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function resetTodoistToken() {
    if (!confirm(
      "Reset Todoist sync tokenu?\n\n" +
      "Příští spuštění todoist-sync udělá FULL snapshot — naimportuje VŠECHNY tvoje aktivní Todoist úkoly do Task tabulky " +
      "(včetně těch které už máš). Existující se updatují, žádné se nezduplikují.",
    )) return;
    setBusy("reset");
    setErr(null);
    setResetMsg(null);
    try {
      const res = await fetch("/api/todoist/reset-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Reset selhal.");
        return;
      }
      setResetMsg(data.note ?? "Token resetován. Klikni Spustit teď.");
    } finally {
      setBusy(null);
    }
  }

  async function hardResetTodoist() {
    if (!confirm(
      "HARD RESET Todoist mirroru?\n\n" +
      "Vyprázdní TodoistProjectMirror + TodoistLabelMirror v naší DB a odpojí Task rows " +
      "od todoistTaskId / todoistProjectId. Použít POUZE pokud jsi v Todoist UI smazal/archivoval " +
      "projekty a chceš čistý stav v Rašeliništi.\n\n" +
      "Existující Task rows v naší DB ZŮSTÁVAJÍ. Příští sync naimportuje aktuální stav z Todoistu.",
    )) return;
    if (!confirm("Opravdu? Tohle nejde vrátit zpět.")) return;
    setBusy("hardreset");
    setErr(null);
    setResetMsg(null);
    try {
      const res = await fetch("/api/todoist/reset-sync?hard=1", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Hard reset selhal.");
        return;
      }
      setResetMsg(
        `HARD RESET hotov: smazáno ${data.deletedProjects} projektů, ${data.deletedLabels} labelů, ` +
        `odpojeno ${data.updatedTasks} Tasků. ${data.note}`,
      );
    } finally {
      setBusy(null);
    }
  }

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
        <button
          onClick={resetTodoistToken}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-md bg-[var(--tint-rose)]/10 border border-[var(--tint-rose)]/30 hover:bg-[var(--tint-rose)]/20 text-[var(--tint-rose)] text-sm flex items-center gap-1.5 transition disabled:opacity-50"
          title="Vyresetuje Todoist sync token → příští spuštění udělá full snapshot (re-import všech úkolů)"
        >
          {busy === "reset" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Reset Todoist sync
        </button>
        <button
          onClick={hardResetTodoist}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/40 hover:bg-destructive/20 text-destructive text-sm flex items-center gap-1.5 transition disabled:opacity-50"
          title="HARD RESET — vyprázdní project + label mirror, odpojí Task rows od Todoist ID. Pro situaci 'smazal jsem projekty v Todoistu, chci čistý stav'"
        >
          {busy === "hardreset" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Hard reset mirror
        </button>
      </div>

      {resetMsg && (
        <div className="text-xs text-[var(--tint-rose)] rounded-md border border-[var(--tint-rose)]/30 bg-[var(--tint-rose)]/[0.06] px-3 py-2">
          {resetMsg}
        </div>
      )}

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
