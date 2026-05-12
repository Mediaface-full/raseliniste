import { useState } from "react";
import { Mail, Loader2, Check, TriangleAlert, RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";

interface InitialProps {
  emailsCount: number;
  gmailSyncedAt: string | null;
  gmailSyncError: string | null;
  hasHistoryId: boolean;
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
export default function PostaIntegration({ initial }: { initial: InitialProps }) {
  const [emailsCount, setEmailsCount] = useState(initial.emailsCount);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initial.gmailSyncedAt);

  async function runSync() {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/google/posta-init", { method: "POST" });
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

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Importované maily
          </div>
          <div className="font-mono text-2xl mt-0.5">{emailsCount}</div>
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

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runSync} disabled={syncing}>
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
        <span className="text-xs text-muted-foreground">
          {initial.hasHistoryId
            ? "Pull mailů z posledních 24 h (max 100)"
            : "Pull mailů z posledních 7 dnů (max 100)"}
        </span>
      </div>

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
            <div>✓ Naimportováno: {result.imported}</div>
            <div>↺ Přeskočeno (už v DB): {result.skipped}</div>
            {result.errors > 0 && <div className="text-red-400">✗ Chyb: {result.errors}</div>}
            <div>⏱ Doba: {(result.durationMs / 1000).toFixed(1)} s</div>
            {result.emailAddress && <div>📧 {result.emailAddress}</div>}
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
