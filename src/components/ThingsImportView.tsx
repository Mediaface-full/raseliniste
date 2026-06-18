import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, Trash2, ListOrdered, X, Download } from "lucide-react";
import { Button } from "./ui/Button";

/**
 * UI pro Things bulk import.
 *
 * Tři stavy:
 *   1. Žádný import → file picker
 *   2. uploaded → preview tabulka + tlačítko "Spustit import" / "Zrušit"
 *   3. executing/completed → progress bar + logy (polling 2s)
 */

interface ImportSummary {
  id: string;
  filename: string;
  status: string;
  totalCount: number;
  migrateCount: number;
  wishlistCount: number;
  discardCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface ImportItem {
  id: string;
  thingsUuid: string;
  title: string;
  decision: string;
  pushResult: string | null;
  pushedTaskId: string | null;
  pushedAt: string | null;
}

interface ImportDetail {
  import: ImportSummary & { items?: ImportItem[]; errorLog?: unknown };
  counts: {
    total: number;
    migrate: number;
    wishlist: number;
    discard: number;
    pushedOk: number;
    pushedSkipped: number;
    pushedError: number;
    pending: number;
  };
}

export default function ThingsImportView() {
  const [history, setHistory] = useState<ImportSummary[]>([]);
  const [active, setActive] = useState<ImportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [validationIssues, setValidationIssues] = useState<any[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<number | null>(null);

  async function loadHistory() {
    setLoading(true);
    try {
      const res = await fetch("/api/things/import");
      const data = await res.json();
      if (res.ok) setHistory(data.imports);
    } finally {
      setLoading(false);
    }
  }

  async function loadActive(id: string, includeItems = false) {
    const res = await fetch(`/api/things/import/${id}${includeItems ? "?includeItems=true" : ""}`);
    if (res.ok) {
      const data = await res.json();
      setActive(data);
      return data as ImportDetail;
    }
    return null;
  }

  useEffect(() => {
    loadHistory();
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  // Polling pro executing import
  useEffect(() => {
    if (!active || active.import.status !== "executing") {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    pollingRef.current = window.setInterval(() => {
      loadActive(active.import.id, true).then((d) => {
        if (d && d.import.status !== "executing") {
          if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          loadHistory();
        }
      });
    }, 2000);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [active?.import.id, active?.import.status]);

  async function uploadFile(file: File) {
    setError(null);
    setValidationIssues(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/things/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload selhal.");
        if (data.issues) setValidationIssues(data.issues);
        return;
      }
      await loadActive(data.import.id, true);
      await loadHistory();
    } finally {
      setUploading(false);
    }
  }

  async function executeNow() {
    if (!active) return;
    setError(null);
    const res = await fetch(`/api/things/import/${active.import.id}/execute`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Spuštění selhalo.");
      return;
    }
    await loadActive(active.import.id, true);
  }

  async function deleteImport(id: string) {
    if (!confirm("Smazat import? Záznamy v Task / Knowledge zůstanou pokud už proběhl.")) return;
    const res = await fetch(`/api/things/import/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (active?.import.id === id) setActive(null);
      loadHistory();
    } else {
      const data = await res.json();
      setError(data.error ?? "Smazání selhalo.");
    }
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="glass-strong rounded-xl p-4">
        <h1 className="font-serif text-2xl mb-2">Things bulk import</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Nahraj <strong>srovnaný JSON</strong> (po review v jiné konverzaci) — Rašeliniště ho
          jen zpracuje. Pro každý úkol musí být <code>decision</code>: <code>migrate</code> →
          Todoist, <code>wishlist</code> → Knowledge entry, <code>discard</code> → přeskočit.
        </p>
      </div>

      {/* UPLOAD */}
      {!active && (
        <div className="glass rounded-xl p-6 text-center space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <><Loader2 className="animate-spin" /> Nahrávám…</> : <><Upload /> Vybrat curated JSON</>}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Schema: <code className="font-mono">source: "things-export-curated"</code>, <code className="font-mono">items[]</code> s <code className="font-mono">thingsUuid, title, decision</code>.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="inline size-4 mr-1" /> {error}
          {validationIssues && (
            <ul className="mt-2 list-disc pl-5 text-xs space-y-0.5">
              {validationIssues.slice(0, 20).map((i, k) => (
                <li key={k}><strong>{i.path}:</strong> {i.message}</li>
              ))}
              {validationIssues.length > 20 && (
                <li>… a {validationIssues.length - 20} dalších</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ACTIVE IMPORT */}
      {active && (
        <div className="glass rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-serif text-lg">{active.import.filename}</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                {new Date(active.import.createdAt).toLocaleString("cs-CZ")} · status{" "}
                <span className={
                  active.import.status === "completed" ? "text-[var(--tint-sage)]"
                  : active.import.status === "executing" ? "text-[var(--tint-butter)]"
                  : active.import.status === "failed" ? "text-destructive"
                  : "text-foreground"
                }>{active.import.status}</span>
              </div>
            </div>
            <button
              onClick={() => setActive(null)}
              className="p-2 rounded-md hover:bg-white/5 text-muted-foreground"
              title="Zavřít"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="Total" value={active.counts.total} />
            <Stat label="Migrate" value={active.counts.migrate} tint="sky" />
            <Stat label="Wishlist" value={active.counts.wishlist} tint="butter" />
            <Stat label="Discard" value={active.counts.discard} tint="muted" />
          </div>

          {/* Progress (executing) */}
          {active.import.status === "executing" && (
            <div className="rounded-md border border-[var(--tint-butter)]/30 bg-[var(--tint-butter)]/[0.06] p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-[var(--tint-butter)]" />
                Zpracovávám… {active.counts.pushedOk + active.counts.pushedSkipped + active.counts.pushedError} / {active.counts.total}
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--tint-butter)] transition-all"
                  style={{ width: `${Math.round(((active.counts.pushedOk + active.counts.pushedSkipped + active.counts.pushedError) / Math.max(1, active.counts.total)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Completed */}
          {active.import.status === "completed" && (
            <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/[0.06] p-3 text-sm">
              <CheckCircle2 className="inline size-4 mr-1 text-[var(--tint-sage)]" />
              Hotovo · <strong>{active.counts.pushedOk}</strong> OK,{" "}
              <strong>{active.counts.pushedSkipped}</strong> skipped,{" "}
              {active.counts.pushedError > 0 && (
                <strong className="text-destructive">{active.counts.pushedError} chyb</strong>
              )}
              {active.counts.pushedError === 0 && <span>0 chyb</span>}
              {active.import.completedAt && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Dokončeno {new Date(active.import.completedAt).toLocaleTimeString("cs-CZ")}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {active.import.status === "uploaded" && (
            <div className="flex gap-2">
              <Button onClick={executeNow}>
                <ListOrdered /> Spustit import
              </Button>
              <Button variant="ghost" onClick={() => deleteImport(active.import.id)}>
                <Trash2 /> Zrušit
              </Button>
            </div>
          )}

          {active.import.status === "completed" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button onClick={() => (window.location.href = "/ukoly")}>
                  Otevřít /ukoly
                </Button>
                <Button variant="ghost" onClick={() => setActive(null)}>Zavřít</Button>
              </div>
              <RemigrateToTodoistButton importId={active.import.id} onDone={() => loadActive(active.import.id, true)} />
            </div>
          )}

          {/* Items table */}
          {active.import.items && (
            <details className="rounded-md border border-white/5">
              <summary className="cursor-pointer px-3 py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Položky ({active.import.items.length}) {active.counts.pushedError > 0 && (
                  <span className="text-destructive">· {active.counts.pushedError} chyb</span>
                )}
              </summary>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0c1126]">
                    <tr className="text-[10px] uppercase font-mono text-muted-foreground">
                      <th className="text-left px-3 py-2">Title</th>
                      <th className="text-left px-3 py-2">Decision</th>
                      <th className="text-left px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.import.items.map((it) => (
                      <tr key={it.id} className="border-t border-white/5 align-top">
                        <td className="px-3 py-1.5 max-w-md">
                          <div className="truncate">{it.title}</div>
                          {it.pushResult?.startsWith("error:") && (
                            <div className="text-[10px] text-destructive/80 mt-0.5 font-mono whitespace-pre-wrap break-words">
                              {it.pushResult.replace(/^error: /, "")}
                            </div>
                          )}
                          {it.pushResult?.startsWith("partial:") && (
                            <div className="text-[10px] text-[var(--tint-butter)] mt-0.5 font-mono whitespace-pre-wrap break-words">
                              {it.pushResult}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px]">
                          {decisionBadge(it.decision)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px]">
                          {it.pushResult === "ok" && <span className="text-[var(--tint-sage)]">ok</span>}
                          {it.pushResult?.startsWith("ok (") && <span className="text-[var(--tint-sage)]">ok+sub</span>}
                          {it.pushResult === "skipped" && <span className="text-muted-foreground">— skipped</span>}
                          {it.pushResult?.startsWith("error:") && <span className="text-destructive">error</span>}
                          {it.pushResult?.startsWith("partial:") && <span className="text-[var(--tint-butter)]">⚠ partial</span>}
                          {it.pushResult === null && <span className="text-muted-foreground">…</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Plný errorLog — agregovaný seznam plných error messages
              (pushResult je truncated 200 znaků, errorLog má full).
              Plus tlačítko "Stáhnout" — pro AI co vyrobí opravený JSON. */}
          {active.import.errorLog && Array.isArray(active.import.errorLog) && (active.import.errorLog as unknown[]).length > 0 && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/[0.05]">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-destructive/20">
                <span className="text-xs font-mono text-destructive font-semibold flex-1">
                  ErrorLog — {(active.import.errorLog as unknown[]).length} chyb
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const log = {
                      importId: active.import.id,
                      filename: active.import.filename ?? "import",
                      executedAt: active.import.completedAt,
                      counts: active.counts,
                      errors: active.import.errorLog,
                      // Vč. pushResult pro VŠECHNY items — full audit pro AI co opraví JSON
                      items: active.import.items?.map((it) => ({
                        thingsUuid: it.thingsUuid,
                        title: it.title,
                        decision: it.decision,
                        pushResult: it.pushResult,
                      })),
                    };
                    const blob = new Blob([JSON.stringify(log, null, 2)], {
                      type: "application/json;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `things-import-errors-${active.import.id.slice(0, 8)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-xs font-mono text-destructive hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-destructive/10"
                  title="Stáhnout error log + per-item pushResult jako JSON (pro AI co vyrobí opravený import)"
                >
                  <Download className="size-3" /> Stáhnout JSON
                </button>
              </div>
              <ul className="px-3 py-2 space-y-2 text-xs font-mono max-h-[480px] overflow-y-auto">
                {(active.import.errorLog as Array<{ thingsUuid: string; title: string; error: string }>).map((e, i) => (
                  <li key={i} className="border-l-2 border-destructive/40 pl-2">
                    <div className="text-foreground font-semibold">{e.title}</div>
                    <div className="text-[10px] text-muted-foreground">uuid: {e.thingsUuid}</div>
                    <div className="text-destructive whitespace-pre-wrap break-words mt-0.5">{e.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      <div className="glass rounded-xl p-4">
        <h2 className="font-serif text-lg mb-3">Historie importů</h2>
        {loading ? (
          <div className="text-sm text-muted-foreground">Načítám…</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Zatím žádný import.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase font-mono text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5">Soubor</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="text-right px-2 py-1.5">Items</th>
                <th className="text-left px-2 py-1.5">Datum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-white/5">
                  <td className="px-2 py-2 truncate max-w-[200px]">{h.filename}</td>
                  <td className="px-2 py-2 font-mono text-xs">{h.status}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {h.totalCount} ({h.migrateCount}/{h.wishlistCount}/{h.discardCount})
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                    {new Date(h.createdAt).toLocaleDateString("cs-CZ")}
                  </td>
                  <td className="px-2 py-2 flex gap-1 justify-end">
                    <button
                      onClick={() => loadActive(h.id, true)}
                      className="p-1.5 hover:bg-white/5 rounded text-muted-foreground hover:text-foreground"
                      title="Detail"
                    >
                      <ListOrdered className="size-3.5" />
                    </button>
                    <button
                      onClick={() => deleteImport(h.id)}
                      className="p-1.5 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                      title="Smazat"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tint = "foreground" }: { label: string; value: number; tint?: "sky" | "butter" | "muted" | "foreground" }) {
  const color =
    tint === "sky" ? "text-[var(--tint-sky)]"
    : tint === "butter" ? "text-[var(--tint-butter)]"
    : tint === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <div className="rounded-md bg-white/[0.03] border border-white/5 p-2">
      <div className={`font-serif text-xl ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{label}</div>
    </div>
  );
}

function decisionBadge(d: string) {
  if (d === "migrate") return <span className="text-[var(--tint-sky)]">→ migrate</span>;
  if (d === "wishlist") return <span className="text-[var(--tint-butter)]">★ wishlist</span>;
  if (d === "discard") return <span className="text-muted-foreground">× discard</span>;
  return <span>{d}</span>;
}

// =============================================================================
// Remigrate wishlist → Todoist
// Pro import kde wishlist body skončily jako Knowledge entries místo Todoist
// tasků. One-click oprava: auto-create projekt Wishlist, push všech wishlist
// items, smaže duplicitní Knowledge entries.
// =============================================================================

function RemigrateToTodoistButton({ importId, onDone }: { importId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!confirm(
      "Smigrovat wishlist body do Todoistu?\n\n" +
      "Co se stane:\n" +
      "1. Auto-create Todoist projekt 'Wishlist' (pokud chybí)\n" +
      "2. Vytvoří Todoist task pro každou wishlist položku\n" +
      "3. Smaže odpovídající Knowledge entries (cleanup duplicit)\n\n" +
      "Idempotentní — když klikneš znovu, už zmigrované přeskočí.",
    )) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/things/import/${importId}/remigrate-to-todoist`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Migrace selhala.");
        return;
      }
      setResult(data);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={run}
        disabled={busy}
        className="w-full px-4 py-2.5 rounded-md bg-[var(--tint-sky)]/15 border border-[var(--tint-sky)]/40 hover:bg-[var(--tint-sky)]/25 text-[var(--tint-sky)] font-medium text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Smigrovat wishlist do Todoistu (one-click)
      </button>
      {err && (
        <div className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          ⚠ {err}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/[0.08] p-3 text-xs space-y-1">
          <div className="text-[var(--tint-sage)] font-medium">
            Hotovo
            {result.todoistProject.created && " · projekt Wishlist vytvořen v Todoistu"}
          </div>
          <div>
            <strong>{result.summary.createdTasks}</strong> nových Todoist tasků,{" "}
            <strong>{result.summary.deletedEntries}</strong> Knowledge entries smazaných
            {result.summary.skippedAlreadyMigrated > 0 && `, ${result.summary.skippedAlreadyMigrated}× přeskočeno (už zmigrované)`}
            {result.summary.failed > 0 && (
              <span className="text-destructive">, {result.summary.failed} chyb</span>
            )}
          </div>
          {result.errors && result.errors.length > 0 && (
            <details className="text-destructive">
              <summary className="cursor-pointer">Chyby</summary>
              <ul className="list-disc pl-4 mt-1">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {result.errors.map((e: any, i: number) => (
                  <li key={i}><strong>{e.title}</strong>: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
