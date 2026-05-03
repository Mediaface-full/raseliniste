import { useState } from "react";
import { Loader2, Search, Trash2, Check, AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";

type DryRunResult = {
  ok: boolean;
  dryRun?: boolean;
  message?: string;
  indexCheck?: Array<{ indexname: string; indexdef: string }>;
  plan?: Array<{
    source: string;
    externalId: string;
    keep: { id: string; lastSyncedAt: string };
    remove: Array<{ id: string; lastSyncedAt: string }>;
  }>;
  deleted?: number;
  groups?: number;
};

export default function CalendarCleanupTool() {
  const [busy, setBusy] = useState<"check" | "delete" | null>(null);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(confirm: boolean) {
    setBusy(confirm ? "delete" : "check");
    setError(null);
    if (!confirm) setResult(null);
    try {
      const url = confirm
        ? "/api/diagnose/calendar-cleanup?confirm=1"
        : "/api/diagnose/calendar-cleanup";
      const res = await fetch(url, { method: "POST" });
      const data: DryRunResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const totalToRemove = result?.plan?.reduce((sum, p) => sum + p.remove.length, 0) ?? 0;
  const hasUniqueIndex = result?.indexCheck?.some((i) => i.indexdef.includes("UNIQUE"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => run(false)} disabled={busy !== null} variant="outline">
          {busy === "check" ? <Loader2 className="animate-spin" /> : <Search />}
          Najít duplikáty (DRY RUN)
        </Button>
        {result?.dryRun && totalToRemove > 0 && (
          <Button
            onClick={() => {
              if (confirm(`Smazat ${totalToRemove} duplicitních řádků z DB?`)) run(true);
            }}
            disabled={busy !== null}
            variant="destructive"
          >
            {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Smazat {totalToRemove} duplikátů
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {result.deleted !== undefined && (
            <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 p-3 text-sm flex items-start gap-2">
              <Check className="size-4 text-[var(--tint-sage)] shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-[var(--tint-sage)]">
                  Smazáno {result.deleted} duplikátů ve {result.groups} skupinách.
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Otevři <a className="underline" href="/calendar">/calendar</a> a zkontroluj.
                </div>
              </div>
            </div>
          )}

          {result.dryRun && totalToRemove === 0 && (
            <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 p-3 text-sm flex items-start gap-2">
              <Check className="size-4 text-[var(--tint-sage)] shrink-0 mt-0.5" />
              <div className="font-medium text-[var(--tint-sage)]">
                Žádné same-source duplikáty. Vše čisté.
              </div>
            </div>
          )}

          {result.dryRun && totalToRemove > 0 && (
            <div className="rounded-md border border-[var(--tint-butter)]/30 bg-[var(--tint-butter)]/10 p-3 text-sm">
              <div className="font-medium text-[var(--tint-butter)] mb-1">
                Nalezeno {totalToRemove} duplikátů ve {result.plan?.length} skupinách.
              </div>
              <div className="text-xs text-muted-foreground">
                Pro každou skupinu zachováme záznam s nejnovějším syncem, ostatní smažeme.
                Zkontroluj a klikni Smazat.
              </div>
            </div>
          )}

          {result.indexCheck && (
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                Stav unique indexu v DB
              </div>
              {hasUniqueIndex ? (
                <div className="flex items-start gap-2">
                  <Check className="size-4 text-[var(--tint-sage)] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[var(--tint-sage)] font-medium">
                      Unique index existuje — duplikáty by neměly vznikat dál.
                    </div>
                    <div className="text-xs font-mono text-muted-foreground mt-1">
                      {result.indexCheck.find((i) => i.indexdef.includes("UNIQUE"))?.indexname}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <div className="text-destructive font-medium">
                      Unique index CHYBÍ — duplikáty mohou vzniknout znovu. Pošli Petrovi.
                    </div>
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        Indexy na CalendarEvent ({result.indexCheck.length})
                      </summary>
                      <pre className="text-[10px] font-mono text-muted-foreground mt-2 overflow-x-auto">
                        {JSON.stringify(result.indexCheck, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              )}
            </div>
          )}

          {result.plan && result.plan.length > 0 && (
            <details className="rounded-md border border-white/10 bg-white/5 p-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Detail {result.plan.length} skupin ({totalToRemove} duplikátů ke smazání)
              </summary>
              <ul className="mt-3 space-y-2 text-xs font-mono">
                {result.plan.slice(0, 50).map((g, i) => (
                  <li key={i} className="border-l-2 border-[var(--tint-rose)]/40 pl-2">
                    <div className="text-foreground">
                      {g.source} · {g.externalId.slice(0, 30)}…
                    </div>
                    <div className="text-muted-foreground">
                      keep: {g.keep.id.slice(0, 10)}… (sync {g.keep.lastSyncedAt.slice(0, 19)})
                    </div>
                    <div className="text-destructive/80">
                      remove: {g.remove.length}× —{" "}
                      {g.remove.map((r) => r.id.slice(0, 10) + "…").join(", ")}
                    </div>
                  </li>
                ))}
                {result.plan.length > 50 && (
                  <li className="text-muted-foreground italic">
                    … a další {result.plan.length - 50} skupin
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
