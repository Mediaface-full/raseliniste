import { useState, useEffect } from "react";
import { Mail, Loader2, Check, TriangleAlert, RefreshCw, Tags, FileText, History, Trash2 } from "lucide-react";
import { Button } from "./ui/Button";

interface InitialProps {
  emailsCount: number;
  classifiedCount: number;
  gmailSyncedAt: string | null;
  gmailSyncError: string | null;
  hasHistoryId: boolean;
  backfill?: {
    started: boolean;
    completed: boolean;
    inProgress: boolean;
    years: number | null;
    totalFetched: number;
    error: string | null;
  } | null;
}

interface SyncResult {
  mode: "init" | "incremental";
  imported: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ gmailMessageId: string; error: string }>;
  durationMs: number;
  emailAddress?: string;
  historyId?: string | null;
}

/**
 * Pošta integrační karta — fáze 1.
 *
 * Zobrazuje stav (počet importovaných mailů, poslední sync, last error)
 * a tlačítko Spustit sync. Volá `/api/integrations/google/posta-init`.
 *
 * Tint: `--tint-cool-blue` (nový pro Poštu).
 */
interface ClassifyResult {
  mode: "pending" | "specific";
  total: number;
  classified: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ emailId: string; error: string }>;
  durationMs?: number;
}

export default function PostaIntegration({ initial }: { initial: InitialProps }) {
  const [emailsCount, setEmailsCount] = useState(initial.emailsCount);
  const [classifiedCount, setClassifiedCount] = useState(initial.classifiedCount);
  const [syncing, setSyncing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initial.gmailSyncedAt);

  async function runSync(opts?: { reinit?: boolean }) {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const url = opts?.reinit
        ? "/api/integrations/google/posta-init?reinit=1"
        : "/api/integrations/google/posta-init";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sync selhal.");
        return;
      }
      setResult(data.stats);
      setLastSyncedAt(new Date().toISOString());
      setEmailsCount((c) => c + (data.stats.imported ?? 0));
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSyncing(false);
    }
  }

  async function runClassify() {
    setClassifying(true);
    setError(null);
    setClassifyResult(null);
    try {
      const res = await fetch("/api/integrations/google/posta-classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Klasifikace selhala.");
        return;
      }
      setClassifyResult(data);
      setClassifiedCount((c) => c + (data.classified ?? 0));
    } catch {
      setError("Síťová chyba.");
    } finally {
      setClassifying(false);
    }
  }

  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [digestMessage, setDigestMessage] = useState<string | null>(null);

  // Backfill state — polling kazdych 10s pokud aktivni
  const [backfillStatus, setBackfillStatus] = useState(initial.backfill ?? null);
  const [backfillStarting, setBackfillStarting] = useState(false);
  const [backfillYears, setBackfillYears] = useState<number | "all">(6);

  useEffect(() => {
    if (!backfillStatus?.inProgress) return;
    const id = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/integrations/google/posta-backfill");
          const data = await res.json();
          if (data.ok) setBackfillStatus(data.status);
        } catch { /* ignore */ }
      })();
    }, 10_000);
    return () => clearInterval(id);
  }, [backfillStatus?.inProgress]);

  async function startBackfill() {
    setBackfillStarting(true);
    setError(null);
    try {
      const years = backfillYears === "all" ? null : backfillYears;
      const res = await fetch("/api/integrations/google/posta-backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ years }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Start backfillu selhal.");
        return;
      }
      // Refresh status
      const statusRes = await fetch("/api/integrations/google/posta-backfill");
      const statusData = await statusRes.json();
      if (statusData.ok) setBackfillStatus(statusData.status);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setBackfillStarting(false);
    }
  }

  async function runDigest() {
    setGeneratingDigest(true);
    setError(null);
    setDigestMessage(null);
    try {
      const res = await fetch("/api/integrations/google/posta-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Generování digestu selhalo.");
        return;
      }
      setDigestMessage(
        `Digest vygenerován (${data.stats.totalActiveEmails} aktivních mailů, ${(data.stats.durationMs / 1000).toFixed(1)} s). Otevři /posta.`,
      );
      setTimeout(() => setDigestMessage(null), 8000);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setGeneratingDigest(false);
    }
  }

  return (
    <div
      className="glass rounded-2xl p-6 space-y-4"
      style={{ ["--c" as string]: "var(--tint-cool-blue)" }}
    >
      <header className="flex items-start gap-3">
        <div
          className="size-10 rounded-lg grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)" }}
        >
          <Mail className="size-5" style={{ color: "var(--c)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl">Pošta</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Email Intelligence — fáze 1: čistý import Gmail mailů do DB. Klasifikace,
            digesty, vyhledávání a UI ve fázi 2+.
          </p>
        </div>
        <span
          className="text-[10px] uppercase tracking-widest font-mono px-2 py-0.5 rounded-full shrink-0"
          style={{
            background: "color-mix(in oklch, var(--c) 12%, transparent)",
            color: "var(--c)",
          }}
        >
          fáze 1
        </span>
      </header>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {initial.gmailSyncError && !error && !result && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Poslední pokus selhal: {initial.gmailSyncError}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Importované
          </div>
          <div className="font-mono text-2xl mt-0.5">{emailsCount}</div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Klasifikované
          </div>
          <div className="font-mono text-2xl mt-0.5">
            {classifiedCount}
            {emailsCount > 0 && (
              <span className="text-[10px] text-muted-foreground ml-1">
                / {emailsCount}
              </span>
            )}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Poslední sync
          </div>
          <div className="text-xs mt-1">
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleString("cs-CZ")
              : "—"}
          </div>
        </div>
      </div>

      {/* Backfill historie — sekce zobrazena jen kdyz neni completed.
          Po Completed se schová (uz znas historii, dalsi backfill nepotrebujes). */}
      {!backfillStatus?.completed && (
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{
            borderColor: "color-mix(in oklch, var(--c) 30%, transparent)",
            background: "color-mix(in oklch, var(--c) 5%, transparent)",
          }}
        >
          <div className="flex items-start gap-2">
            <History className="size-4 mt-0.5" style={{ color: "var(--c)" }} />
            <div className="flex-1">
              <div className="font-medium text-sm">Zpětný import historie</div>
              <p className="text-xs text-muted-foreground mt-1">
                Stažení metadat (subject + odesílatel + datum, bez body) pro celé období.
                Po importu projdeš <code>/posta/uklid</code> kde smažeš spam / reklamy z Gmailu,
                pak se stáhnou plná těla už jen pro zbylé maily.
              </p>
            </div>
          </div>

          {backfillStatus?.inProgress ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" style={{ color: "var(--c)" }} />
                <span className="font-mono">
                  Probíhá: {backfillStatus.totalFetched.toLocaleString("cs-CZ")} mailů staženo
                  {backfillStatus.years && ` (${backfillStatus.years} let)`}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Běží cron `posta-backfill` 15min ticky. Můžeš zavřít okno, importuje se na pozadí.
              </p>
              {backfillStatus.error && (
                <div className="text-xs text-destructive">Poslední chyba: {backfillStatus.error}</div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-mono uppercase text-muted-foreground">Období:</label>
              <select
                value={backfillYears === "all" ? "all" : String(backfillYears)}
                onChange={(e) => setBackfillYears(e.target.value === "all" ? "all" : (parseInt(e.target.value, 10) as 1 | 2 | 4 | 6))}
                className="px-2 py-1 rounded-md bg-black/30 border border-white/10 text-sm font-mono"
              >
                <option value="1">1 rok</option>
                <option value="2">2 roky</option>
                <option value="4">4 roky</option>
                <option value="6">6 let</option>
                <option value="all">Vše dostupné</option>
              </select>
              <Button
                onClick={startBackfill}
                disabled={backfillStarting}
                className="ml-2"
              >
                {backfillStarting ? (
                  <><Loader2 className="size-4 animate-spin" /> Spouštím…</>
                ) : (
                  <><History className="size-4" /> Spustit zpětný import</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Po Completed: info card s totalFetched + odkaz na /posta/uklid */}
      {backfillStatus?.completed && (
        <div
          className="rounded-xl border p-4 flex items-center gap-3"
          style={{
            borderColor: "color-mix(in oklch, var(--tint-sage) 30%, transparent)",
            background: "color-mix(in oklch, var(--tint-sage) 5%, transparent)",
          }}
        >
          <Check className="size-5 text-[var(--tint-sage)]" />
          <div className="flex-1">
            <div className="font-medium text-sm">Zpětný import hotov</div>
            <div className="text-xs text-muted-foreground">
              {backfillStatus.totalFetched.toLocaleString("cs-CZ")} mailů v DB.
              Otevři <a href="/posta/uklid" className="underline">/posta/uklid</a> a smaž junk.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => runSync()} disabled={syncing || classifying}>
          {syncing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Synchronizuji…
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              {initial.hasHistoryId ? "Synchronizovat nové" : "Spustit první import"}
            </>
          )}
        </Button>
        {initial.hasHistoryId && (
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Stáhnout historii 96 dnů? Může trvat několik minut, max 5000 mailů. Existující se nepřepisuje.")) {
                void runSync({ reinit: true });
              }
            }}
            disabled={syncing || classifying}
            title="Re-init: 96d historie, max 5000 mailů, idempotent (existující se neimportují znovu)"
          >
            <RefreshCw className="w-4 h-4" /> Stáhnout historii 96 dnů
          </Button>
        )}
        <Button variant="outline" onClick={runClassify} disabled={syncing || classifying || generatingDigest}>
          {classifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Klasifikuji…
            </>
          ) : (
            <>
              <Tags className="w-4 h-4" /> Klasifikovat nové (max 50)
            </>
          )}
        </Button>
        <Button variant="ghost" onClick={runDigest} disabled={syncing || classifying || generatingDigest}>
          {generatingDigest ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Generuji digest…
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" /> Vygenerovat digest
            </>
          )}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sync běží automaticky každých 15 min, klasifikace také. Digest se
        generuje 7:00 ráno (cron). Tlačítka jsou on-demand spuštění.
      </p>
      {digestMessage && (
        <div className="text-xs text-emerald-400 font-mono">{digestMessage}</div>
      )}

      {classifyResult && (
        <div
          className="rounded-lg border p-3 text-xs space-y-1"
          style={{
            background: "color-mix(in oklch, var(--c) 8%, transparent)",
            borderColor: "color-mix(in oklch, var(--c) 30%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--c)" }}>
            <Check className="w-4 h-4" />
            Klasifikace hotová
          </div>
          <div className="font-mono text-xs text-muted-foreground space-y-0.5">
            <div>Klasifikováno: {classifyResult.classified}</div>
            <div>↺ Přeskočeno (už klasifikováno): {classifyResult.skipped}</div>
            {classifyResult.errors > 0 && (
              <div className="text-red-400">Chyb: {classifyResult.errors}</div>
            )}
            {classifyResult.durationMs && (
              <div>⏱ Doba: {(classifyResult.durationMs / 1000).toFixed(1)} s</div>
            )}
          </div>
          {classifyResult.errorDetails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Detail chyb ({classifyResult.errorDetails.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-[11px] font-mono">
                {classifyResult.errorDetails.map((e, i) => (
                  <li key={i} className="text-red-400">
                    {e.emailId}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {result && (
        <div
          className="rounded-lg border p-3 text-xs space-y-1"
          style={{
            background: "color-mix(in oklch, var(--c) 8%, transparent)",
            borderColor: "color-mix(in oklch, var(--c) 30%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--c)" }}>
            <Check className="w-4 h-4" />
            Hotovo ({result.mode === "init" ? "první import" : "incremental"})
          </div>
          <div className="font-mono text-xs text-muted-foreground space-y-0.5">
            <div>Naimportováno: {result.imported}</div>
            <div>↺ Přeskočeno (už v DB): {result.skipped}</div>
            {result.errors > 0 && <div className="text-red-400">Chyb: {result.errors}</div>}
            <div>⏱ Doba: {(result.durationMs / 1000).toFixed(1)} s</div>
            {result.emailAddress && <div>{result.emailAddress}</div>}
          </div>
          {result.errorDetails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Detail chyb ({result.errorDetails.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-[11px] font-mono">
                {result.errorDetails.map((e, i) => (
                  <li key={i} className="text-red-400">
                    {e.gmailMessageId}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Jak ověřit import</summary>
        <div className="mt-2 space-y-1 leading-relaxed">
          <p>
            Po prvním sync můžeš zkontrolovat DB přes SQL:
          </p>
          <code className="block bg-background/40 border border-border rounded p-2 font-mono text-[11px]">
            SELECT COUNT(*) FROM "EmailMessage" WHERE "userId" = '...';
            <br />
            SELECT "fromAddress", "subject", "receivedAt"
            <br />
            FROM "EmailMessage" ORDER BY "receivedAt" DESC LIMIT 5;
          </code>
          <p>Sync běží automaticky každých 15 minut (cron <code>posta-sync</code>).</p>
        </div>
      </details>
    </div>
  );
}
