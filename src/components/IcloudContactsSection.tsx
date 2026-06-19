/**
 * Sekce „Kontakty" v /settings/integrations/icloud.
 *
 * Petr 2026-05-15: hledal tlačítko sync kontaktů přímo v iCloud integration
 * page (vedle kalendáře). Patří sem — credentials se sdílejí, sync je
 * konzistentní místo.
 */

import { useState, useEffect } from "react";
import { Cloud, Loader2, Check, AlertTriangle, Users, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "./ui/Button";

interface SyncStats {
  pulled: number;
  created: number;
  updated: number;
  matched: number;
  groups: number;
  errors: number;
  durationMs: number;
}

export default function IcloudContactsSection({
  icloudConnected,
}: {
  icloudConnected: boolean;
}) {
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [groupCount, setGroupCount] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; itemCount?: number; error?: string } | null>(null);

  useEffect(() => {
    if (icloudConnected) void loadStatus();
  }, [icloudConnected]);

  async function loadStatus() {
    try {
      // Pull stats z /api/contacts/tabulka?pageSize=1 (lehký endpoint)
      const res = await fetch("/api/contacts/tabulka?pageSize=1");
      const data = await res.json();
      if (res.ok) {
        setContactCount(data.total ?? 0);
        setGroupCount((data.groups as unknown[])?.length ?? 0);
      }
    } catch { /* ignore */ }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/contacts/icloud/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function runSync() {
    if (!confirm("Stáhnout kontakty + skupiny z iCloudu? Trvá ~1 minutu pro 1000 kontaktů. Overlay pole (VIP/aliases/clientTag) zůstanou nedotčené.")) return;
    setSyncing(true);
    setError(null);
    setStats(null);
    try {
      const res = await fetch("/api/contacts/icloud/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.stats?.error ?? data.error ?? "Sync selhal.");
        return;
      }
      setStats(data.stats);
      setLastSyncAt(new Date().toISOString());
      void loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  if (!icloudConnected) {
    return (
      <div className="glass rounded-xl p-5 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
        <div className="flex items-center gap-2">
          <Users className="size-4" style={{ color: "var(--c)" }} />
          <h3 className="font-serif text-lg">Kontakty</h3>
          <span className="ml-auto text-xs font-mono text-muted-foreground">— nepřipojeno</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Nejdřív připoj iCloud výše (Apple ID + app password). Kontakty sdílí stejné credentials.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="flex items-center gap-2">
        <Users className="size-4" style={{ color: "var(--c)" }} />
        <h3 className="font-serif text-lg">Kontakty</h3>
        <span className="ml-auto text-xs font-mono text-[var(--tint-sage)]">aktivní</span>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        Stažení kontaktů + skupin z iCloudu do Rašeliniště. Overlay pole (VIP, aliasy, klient slug)
        se nepřepisují. Tabulková editace v <a href="/contacts" className="underline">/contacts</a>.
      </p>

      {contactCount !== null && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <div>
              <div className="font-mono text-lg">{contactCount}</div>
              <div className="text-xs text-muted-foreground">kontaktů</div>
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <div>
              <div className="font-mono text-lg">{groupCount}</div>
              <div className="text-xs text-muted-foreground">skupin</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
        <Button onClick={runSync} disabled={syncing || testing}>
          {syncing ? <><Loader2 className="size-4 animate-spin" /> Synchronizuji…</> : <><Cloud className="size-4" /> Stáhnout z iCloudu</>}
        </Button>
        <Button variant="outline" onClick={runTest} disabled={syncing || testing}>
          {testing ? <><Loader2 className="size-4 animate-spin" /> Testuji…</> : <><RefreshCw className="size-4" /> Test připojení</>}
        </Button>
        <a
          href="/contacts"
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-[var(--tint-lavender)] hover:bg-[var(--tint-lavender)]/10"
        >
          Otevřít tabulku <ArrowRight className="size-3.5" />
        </a>
      </div>

      {testResult && (
        <div className={`rounded-md border text-sm px-3 py-2 ${testResult.ok ? "border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10" : "border-destructive/30 bg-destructive/10"}`}>
          {testResult.ok ? (
            <span className="flex items-center gap-2"><Check className="size-4" /> CardDAV připojení funguje. V iCloudu nalezeno {testResult.itemCount} vCardů.</span>
          ) : (
            <span className="flex items-start gap-2"><AlertTriangle className="size-4 shrink-0 mt-0.5" /> Test selhal: {testResult.error}</span>
          )}
        </div>
      )}

      {stats && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 font-medium"><Check className="size-4 text-[var(--tint-sage)]" /> Sync hotový za {(stats.durationMs / 1000).toFixed(1)} s.</div>
          <div className="text-xs font-mono text-muted-foreground">
            Staženo {stats.pulled} · Vytvořeno {stats.created} · Spárováno {stats.matched} · Update {stats.updated} · Skupiny {stats.groups} · Chyby {stats.errors}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Sync selhal</div>
            <div className="text-xs font-mono mt-1 break-all">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
