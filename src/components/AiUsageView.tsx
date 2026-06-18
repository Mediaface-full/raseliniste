import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Loader2, TrendingUp, Coins, Zap, Clock } from "lucide-react";

interface ModuleStat { module: string; calls: number; inputTokens: number; outputTokens: number; usd: number; czk: number; avgCzkPerCall: number; }
interface ModelStat { model: string; calls: number; usd: number; czk: number; }
interface DayStat { day: string; calls: number; czk: number; byModule: Record<string, number>; }
interface RecentCall { id: string; at: string; module: string; model: string; mode: string; inputTokens: number; outputTokens: number; czk: number; durationMs: number; success: boolean; errorMsg: string | null; }
interface Stats {
  total: { calls: number; inputTokens: number; outputTokens: number; usd: number; czk: number };
  byModule: ModuleStat[];
  byModel: ModelStat[];
  byDay: DayStat[];
  recentCalls: RecentCall[];
}

const MODULE_COLORS: Record<string, string> = {
  "briefing": "#7dd3fc",
  "task-extract": "#fb923c",
  "audio-stage1-transcribe": "#a78bfa",
  "audio-stage2-analyze": "#c084fc",
  "event-classifier": "#fbbf24",
  "event-parser": "#facc15",
  "journal-redact": "#fde68a",
  "letter-redact": "#fda4af",
  "health-analyze": "#f87171",
  "project-summary": "#34d399",
  "ai-chat": "#f472b6",
  "capture-classifier": "#fcd34d",
  "health-check": "#94a3b8",
};
const colorFor = (m: string) => MODULE_COLORS[m] ?? "#9ca3af";

export default function AiUsageView() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "month" | "all">("30d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/ai-usage?period=${period}`);
      if (res.ok) setStats(await res.json());
    } finally {
      setLoading(false);
    }
  }

  if (loading || !stats) {
    return <div className="text-center py-12 text-muted-foreground"><Loader2 className="size-8 animate-spin mx-auto" /></div>;
  }

  // Daily projection na konec měsíce (pokud period = month)
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthSoFarCzk = period === "month" ? stats.total.czk : 0;
  const projectedMonthCzk = period === "month" && dayOfMonth > 0 ? (monthSoFarCzk / dayOfMonth) * daysInMonth : 0;
  const avgPerDay = stats.byDay.length > 0 ? stats.total.czk / stats.byDay.length : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">AI náklady</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sledování Gemini volání + odhad nákladů. Ceník Google Gemini 2.5 (kurz USD/CZK 22,5).
        </p>
      </div>

      {/* Period filter */}
      <div className="flex gap-1 flex-wrap">
        {[
          { v: "today", l: "Dnes" },
          { v: "7d", l: "7 dní" },
          { v: "30d", l: "30 dní" },
          { v: "month", l: "Tento měsíc" },
          { v: "all", l: "Vše" },
        ].map((o) => (
          <button
            key={o.v}
            onClick={() => setPeriod(o.v as typeof period)}
            className={`px-3 py-1.5 rounded text-sm font-mono ${
              period === o.v ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Celkem"
          value={`${stats.total.czk.toFixed(2)} Kč`}
          delta={`${stats.total.calls} volání`}
          icon={<Coins className="size-3.5" />}
          tint="sage"
        />
        <Kpi
          label="Tokens"
          value={formatTokens(stats.total.inputTokens + stats.total.outputTokens)}
          delta={`${formatTokens(stats.total.inputTokens)} in / ${formatTokens(stats.total.outputTokens)} out`}
          icon={<Zap className="size-3.5" />}
          tint="butter"
        />
        <Kpi
          label="Průměr/den"
          value={`${avgPerDay.toFixed(2)} Kč`}
          delta={`${stats.byDay.length} dní s daty`}
          icon={<TrendingUp className="size-3.5" />}
          tint="sky"
        />
        {period === "month" ? (
          <Kpi
            label="Predikce měsíce"
            value={`${projectedMonthCzk.toFixed(0)} Kč`}
            delta={`${dayOfMonth}/${daysInMonth} dní`}
            icon={<TrendingUp className="size-3.5" />}
            tint="rose"
          />
        ) : (
          <Kpi
            label="USD"
            value={`$${stats.total.usd.toFixed(3)}`}
            delta={`@ 22,5 Kč/$`}
            icon={<Coins className="size-3.5" />}
            tint="lavender"
          />
        )}
      </section>

      {/* Daily chart */}
      {stats.byDay.length > 0 && (
        <section className="glass rounded-xl p-4">
          <h2 className="font-serif text-lg mb-3">Útrata po dnech (Kč)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byDay.map((d) => ({ ...d, czkRound: Number(d.czk.toFixed(2)) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" stroke="#888" fontSize={10} />
                <YAxis stroke="#888" fontSize={10} unit=" Kč" />
                <Tooltip
                  contentStyle={{ background: "#0c1126", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                  formatter={(value: number) => `${value.toFixed(2)} Kč`}
                />
                <Bar dataKey="czkRound" fill="var(--tint-sky)" name="Kč" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* By module table */}
      <section className="glass rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <h2 className="font-serif text-lg">Per modul</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase font-mono text-muted-foreground">
              <th className="text-left px-4 py-2">Modul</th>
              <th className="text-right px-4 py-2">Volání</th>
              <th className="text-right px-4 py-2">Tokens</th>
              <th className="text-right px-4 py-2">Kč</th>
              <th className="text-right px-4 py-2">Ø/call</th>
            </tr>
          </thead>
          <tbody>
            {stats.byModule.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted-foreground italic py-6">Žádná data v této periodě.</td></tr>
            )}
            {stats.byModule.map((m) => (
              <tr key={m.module} className="border-t border-white/5">
                <td className="px-4 py-2 flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: colorFor(m.module) }} />
                  <span className="font-mono text-xs">{m.module}</span>
                </td>
                <td className="text-right px-4 py-2 font-mono tabular-nums">{m.calls}</td>
                <td className="text-right px-4 py-2 font-mono tabular-nums">{formatTokens(m.inputTokens + m.outputTokens)}</td>
                <td className="text-right px-4 py-2 font-mono tabular-nums">{m.czk.toFixed(2)}</td>
                <td className="text-right px-4 py-2 font-mono tabular-nums text-muted-foreground">{m.avgCzkPerCall.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* By model */}
      <section className="glass rounded-xl p-4">
        <h2 className="font-serif text-lg mb-3">Per model</h2>
        <div className="space-y-2">
          {stats.byModel.map((m) => (
            <div key={m.model} className="flex items-center gap-3 text-sm">
              <span className="font-mono w-48 truncate">{m.model}</span>
              <span className="font-mono text-xs text-muted-foreground w-20">{m.calls} volání</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-[var(--tint-sky)]"
                  style={{ width: `${(m.czk / Math.max(stats.total.czk, 0.001)) * 100}%` }}
                />
              </div>
              <span className="font-mono tabular-nums w-20 text-right">{m.czk.toFixed(2)} Kč</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent calls */}
      <details className="glass rounded-xl overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 font-medium text-sm">Posledních 50 volání</summary>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase font-mono text-muted-foreground">
              <th className="text-left px-3 py-2">Čas</th>
              <th className="text-left px-3 py-2">Modul</th>
              <th className="text-left px-3 py-2">Model</th>
              <th className="text-right px-3 py-2">In</th>
              <th className="text-right px-3 py-2">Out</th>
              <th className="text-right px-3 py-2">Kč</th>
              <th className="text-right px-3 py-2">ms</th>
              <th className="px-3 py-2">Stav</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentCalls.map((c) => (
              <tr key={c.id} className="border-t border-white/5">
                <td className="px-3 py-1.5 font-mono">{new Date(c.at).toLocaleString("cs-CZ", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td>
                <td className="px-3 py-1.5 font-mono">{c.module}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{c.model.replace("gemini-2.5-", "")}</td>
                <td className="text-right px-3 py-1.5 font-mono tabular-nums">{c.inputTokens.toLocaleString("cs-CZ")}</td>
                <td className="text-right px-3 py-1.5 font-mono tabular-nums">{c.outputTokens.toLocaleString("cs-CZ")}</td>
                <td className="text-right px-3 py-1.5 font-mono tabular-nums">{c.czk.toFixed(3)}</td>
                <td className="text-right px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{c.durationMs}</td>
                <td className="px-3 py-1.5">
                  {c.success
                    ? <span className="text-[var(--tint-sage)]"></span>
                    : <span className="text-[var(--tint-rose)]" title={c.errorMsg ?? ""}></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="text-xs text-muted-foreground italic">
        Ceník: Flash $0,30 in / $2,50 out · Pro $1,25 in / $10,00 out (per 1M tokenů). USD→CZK 22,5.
        Reálná GCP fakturace se může lišit ±5 % (zaokrouhlení, batch discounts).
      </p>
    </div>
  );
}

function Kpi({ label, value, delta, icon, tint }: { label: string; value: string; delta?: string; icon: React.ReactNode; tint: string }) {
  return (
    <article className="glass rounded-xl p-4 relative overflow-hidden" style={{ ["--c" as string]: `var(--tint-${tint})` }}>
      <div className="absolute -top-10 -right-10 size-24 rounded-full blur-2xl" style={{ background: "color-mix(in oklch, var(--c) 25%, transparent)" }} />
      <div className="relative flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted-foreground">{label}</span>
        <span className="text-[var(--c)]">{icon}</span>
      </div>
      <div className="font-serif text-2xl mt-2 tabular-nums">{value}</div>
      {delta && <div className="text-xs text-muted-foreground font-mono mt-1">{delta}</div>}
    </article>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return n.toString();
}
