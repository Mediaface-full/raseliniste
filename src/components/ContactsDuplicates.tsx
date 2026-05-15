/**
 * Detekce + merge duplicit kontaktů.
 *
 * Petr 2026-05-15 (kontakty_brief.md 5.8 B):
 *   - Klik „Najít duplicity" → GET /api/contacts/duplicates
 *   - Pro každý cluster radio buttons pro výběr primárky
 *   - Sloučit a smazat ostatní — merge endpoint
 *   - Primary zachová overlay pole (isVip/aliases/clientTag/...) +
 *     icloudUid; sekundární se sloučí (telefony union, emaily union,
 *     skupiny union, chybějící skalární doplnit)
 */

import { useState } from "react";
import { Loader2, Users, Merge, AlertTriangle, Check, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "./ui/Button";

interface ClusterContact {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phones: string[];
  emails: string[];
  isVip: boolean;
  isTeam: boolean;
  clientTag: string | null;
  icloudUid: string | null;
  syncSource: string | null;
  createdAt: string;
}

interface Cluster {
  id: string;
  reason: string[];
  contacts: ClusterContact[];
}

export default function ContactsDuplicates() {
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [primaries, setPrimaries] = useState<Record<string, string>>({}); // clusterId → contactId
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadClusters() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/contacts/duplicates");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Načtení duplicit selhalo.");
        return;
      }
      setClusters(data.clusters);
      // Default primary = první kontakt v každém clusteru (nejstarší — preferuj historicky existující)
      const defaults: Record<string, string> = {};
      for (const c of data.clusters) {
        // Preferuj iCloud-synced kontakt jako primary (má icloudUid)
        const withUid = c.contacts.find((x: ClusterContact) => x.icloudUid);
        defaults[c.id] = withUid?.id ?? c.contacts[0].id;
      }
      setPrimaries(defaults);
      // Expand všechny defaultně, ať Petr vidí obsah
      setExpanded(new Set(data.clusters.map((c: Cluster) => c.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function mergeCluster(cluster: Cluster) {
    const primaryId = primaries[cluster.id];
    if (!primaryId) {
      setError("Vyber primární kontakt v clusteru.");
      return;
    }
    const secondaries = cluster.contacts.filter((c) => c.id !== primaryId);
    if (secondaries.length === 0) return;

    const primaryName = cluster.contacts.find((c) => c.id === primaryId)?.displayName ?? "?";
    const confirmMsg = `Sloučit ${secondaries.length} duplicit do "${primaryName}"?\n\n` +
      `Telefony/emaily/skupiny: union. Chybějící pole doplníme. ` +
      `Overlay pole (VIP, aliasy, klient slug) zachováme primární.\n\n` +
      `Sekundární kontakty se smažou.`;
    if (!confirm(confirmMsg)) return;

    setMerging(cluster.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/contacts/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryId, secondaryIds: secondaries.map((s) => s.id) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Merge selhal.");
        return;
      }
      setSuccess(`Sloučeno ${data.mergedCount} duplicit do "${primaryName}".`);
      // Odebrat cluster z UI
      setClusters((prev) => prev?.filter((c) => c.id !== cluster.id) ?? null);
      setTimeout(() => setSuccess(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(null);
    }
  }

  function toggle(clusterId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }

  return (
    <div className="glass rounded-xl p-5 space-y-4" style={{ ["--c" as string]: "var(--tint-rose)" }}>
      <div className="flex items-center gap-2">
        <Merge className="size-4" style={{ color: "var(--c)" }} />
        <h3 className="font-serif text-lg">Duplicity</h3>
        <span className="ml-auto text-xs font-mono text-muted-foreground">
          {clusters ? `${clusters.length} clusterů` : "—"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        Detekce podle <strong>shody jména</strong> (case-insensitive), <strong>telefonu</strong>{" "}
        (posledních 9 číslic) nebo <strong>e-mailu</strong>. Union-find seskupí překryvy do clusterů.
      </p>

      <Button onClick={loadClusters} disabled={loading}>
        {loading ? <><Loader2 className="size-4 animate-spin" /> Hledám…</> : <><Users className="size-4" /> Najít duplicity</>}
      </Button>

      {success && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4 text-[var(--tint-sage)]" /> {success}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {clusters !== null && clusters.length === 0 && (
        <div className="text-sm text-muted-foreground italic text-center py-4">
          🎉 Žádné duplicity nebyly nalezeny.
        </div>
      )}

      {clusters && clusters.map((cluster) => {
        const isExp = expanded.has(cluster.id);
        const isMerging = merging === cluster.id;
        return (
          <div
            key={cluster.id}
            className="rounded-lg border border-white/10 bg-black/20 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(cluster.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
            >
              {isExp ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <span className="font-medium text-sm">{cluster.contacts.length} kontaktů</span>
              <span className="text-xs text-muted-foreground">
                {cluster.reason.slice(0, 3).join(" · ")}
                {cluster.reason.length > 3 ? ` · +${cluster.reason.length - 3}` : ""}
              </span>
            </button>

            {isExp && (
              <div className="border-t border-white/5 p-3 space-y-3">
                <div className="text-xs font-mono uppercase text-muted-foreground">
                  Vyber primární (zachová overlay pole + icloudUid):
                </div>
                <div className="space-y-2">
                  {cluster.contacts.map((c) => {
                    const isPrimary = primaries[cluster.id] === c.id;
                    return (
                      <label
                        key={c.id}
                        className={`flex items-start gap-3 p-2 rounded-md cursor-pointer transition ${
                          isPrimary ? "bg-[var(--tint-sage)]/10 ring-1 ring-[var(--tint-sage)]/30" : "hover:bg-white/5"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`primary-${cluster.id}`}
                          checked={isPrimary}
                          onChange={() => setPrimaries((p) => ({ ...p, [cluster.id]: c.id }))}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0 text-sm">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            {c.displayName}
                            {c.isVip && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--tint-rose)]/15 text-[var(--tint-rose)]">VIP</span>}
                            {c.isTeam && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--tint-sky)]/15 text-[var(--tint-sky)]">tým</span>}
                            {c.clientTag && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--tint-lavender)]/15 text-[var(--tint-lavender)]">{c.clientTag}</span>}
                            {c.icloudUid && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--tint-mint)]/15 text-[var(--tint-mint)]">iCloud</span>}
                            {c.syncSource && c.syncSource !== "icloud" && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">{c.syncSource}</span>}
                          </div>
                          {c.company && <div className="text-xs text-muted-foreground">🏢 {c.company}</div>}
                          {c.phones.length > 0 && (
                            <div className="text-xs text-muted-foreground font-mono mt-0.5">📞 {c.phones.join(", ")}</div>
                          )}
                          {c.emails.length > 0 && (
                            <div className="text-xs text-muted-foreground font-mono mt-0.5">✉ {c.emails.join(", ")}</div>
                          )}
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                            vytvořeno {new Date(c.createdAt).toLocaleDateString("cs-CZ")}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="pt-2 border-t border-white/5 flex justify-end">
                  <Button
                    onClick={() => mergeCluster(cluster)}
                    disabled={isMerging || !primaries[cluster.id]}
                    className="bg-[var(--tint-sage)]/20 text-[var(--tint-sage)] border-[var(--tint-sage)]/40"
                  >
                    {isMerging ? <><Loader2 className="size-4 animate-spin" /> Slučuji…</> : <><Merge className="size-4" /> Sloučit a smazat ostatní</>}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
