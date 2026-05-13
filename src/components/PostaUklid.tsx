import { useState, useMemo } from "react";
import { Trash2, Loader2, AlertTriangle, Check, Mail, Filter } from "lucide-react";
import { Button } from "./ui/Button";

interface Sender {
  fromAddress: string;
  fromName: string | null;
  count: number;
  dominantContentType: string | null;
  latestSubject: string | null;
  latestReceivedAt: string | null;
}

interface Props {
  senders: Sender[];
  totalMails: number;
}

// Klasifikace newsletter/system jsou prime kandidaty na smazani.
// Personal/work zustanou. Transactional je sporne (faktury), nech defaultne off.
const JUNK_CONTENT_TYPES = new Set(["newsletter", "system", "marketing", "promo"]);

export default function PostaUklid({ senders, totalMails }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "junk-candidates" | "unknown">("junk-candidates");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ trashed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return senders;
    if (filter === "junk-candidates") {
      return senders.filter((s) =>
        s.dominantContentType !== null && JUNK_CONTENT_TYPES.has(s.dominantContentType.toLowerCase()),
      );
    }
    if (filter === "unknown") {
      return senders.filter((s) => s.dominantContentType === null);
    }
    return senders;
  }, [senders, filter]);

  const selectedCount = useMemo(() => {
    return filtered
      .filter((s) => selected.has(s.fromAddress))
      .reduce((sum, s) => sum + s.count, 0);
  }, [filtered, selected]);

  function toggle(fromAddress: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fromAddress)) next.delete(fromAddress);
      else next.add(fromAddress);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((s) => s.fromAddress)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function submitTrash() {
    if (selected.size === 0) return;
    if (!confirm(
      `Přesunout ${selectedCount.toLocaleString("cs-CZ")} mailů od ${selected.size} odesílatelů do Gmail koše?\n\n` +
      `V Gmailu zůstanou 30 dnů, pak se smažou natrvalo. Z Rašeliniště zmizí ihned.`,
    )) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/posta/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromAddresses: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Smazání selhalo.");
        return;
      }
      setResult({ trashed: data.trashed, total: data.total });
      setSelected(new Set());
      // Hard refresh — sender breakdown se musí přerenderovat
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl">Úklid Pošty</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Top 100 odesílatelů ({totalMails.toLocaleString("cs-CZ")} mailů celkem).
          Vyber kdo do koše — přesune ve Gmailu i smaže z Rašeliniště.
          {" "}
          <span className="text-[var(--tint-rose)]">Gmail Trash drží 30 dní</span>, pak jsou pryč navždy.
        </p>
      </div>

      {/* Filtry */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="size-4 text-muted-foreground" />
        <FilterChip active={filter === "junk-candidates"} onClick={() => setFilter("junk-candidates")}>
          Kandidáti na smazání ({senders.filter((s) => s.dominantContentType && JUNK_CONTENT_TYPES.has(s.dominantContentType.toLowerCase())).length})
        </FilterChip>
        <FilterChip active={filter === "unknown"} onClick={() => setFilter("unknown")}>
          Neklasifikované ({senders.filter((s) => !s.dominantContentType).length})
        </FilterChip>
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          Vše ({senders.length})
        </FilterChip>
      </div>

      {/* Akce */}
      <div className="flex flex-wrap items-center gap-2 sticky top-2 z-10 glass rounded-lg p-2">
        <Button variant="outline" onClick={selectAllFiltered} disabled={filtered.length === 0}>
          Vybrat vše v zobrazení ({filtered.length})
        </Button>
        <Button variant="ghost" onClick={clearSelection} disabled={selected.size === 0}>
          Zrušit výběr
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <span className="text-sm font-mono">
              {selected.size} odesílatelů, {selectedCount.toLocaleString("cs-CZ")} mailů
            </span>
          )}
          <Button
            onClick={submitTrash}
            disabled={selected.size === 0 || submitting}
            className="bg-[var(--tint-rose)]/20 hover:bg-[var(--tint-rose)]/30 text-[var(--tint-rose)] border-[var(--tint-rose)]/40"
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" /> Mažu…</>
            ) : (
              <><Trash2 className="size-4" /> Do koše</>
            )}
          </Button>
        </div>
      </div>

      {result && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4" /> {result.trashed} mailů přesunuto do Gmail koše. Refresh za 2 s.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Tabulka odesilatelu */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs font-mono uppercase text-muted-foreground border-b border-white/10">
            <tr>
              <th className="px-3 py-2 text-left w-8"></th>
              <th className="px-3 py-2 text-left">Odesílatel</th>
              <th className="px-3 py-2 text-right">Mailů</th>
              <th className="px-3 py-2 text-left">Klasifikace</th>
              <th className="px-3 py-2 text-left">Poslední subject</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const isSelected = selected.has(s.fromAddress);
              const isJunk = s.dominantContentType && JUNK_CONTENT_TYPES.has(s.dominantContentType.toLowerCase());
              return (
                <tr
                  key={s.fromAddress}
                  className={`border-b border-white/5 cursor-pointer transition ${
                    isSelected ? "bg-[var(--tint-rose)]/10" : "hover:bg-white/5"
                  }`}
                  onClick={() => toggle(s.fromAddress)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(s.fromAddress)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.fromName ?? s.fromAddress}</div>
                    {s.fromName && (
                      <div className="text-xs text-muted-foreground font-mono">{s.fromAddress}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{s.count.toLocaleString("cs-CZ")}</td>
                  <td className="px-3 py-2">
                    {s.dominantContentType ? (
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                          isJunk ? "bg-[var(--tint-rose)]/15 text-[var(--tint-rose)]" : "bg-white/10 text-muted-foreground"
                        }`}
                      >
                        {s.dominantContentType}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-md">
                    {s.latestSubject ?? "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground italic">
                  Žádní odesílatelé v aktuálním filtru.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <Mail className="size-3 inline mr-1" />
        Klasifikace probíhá v pozadí — pokud je sloupec prázdný, klasifikátor mail ještě nezpracoval (cron 15 min).
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-mono transition ${
        active ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
