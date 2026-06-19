import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bed,
  Flame,
  Footprints,
  Heart,
  HeartPulse,
  Loader2,
  Minus,
  Moon,
  Mountain,
  Scale,
  Sparkles,
  Timer,
  TrendingUp,
  Wind,
} from "lucide-react";
import { Button } from "../ui/Button";
import {
  BloodPressureChart,
  SimpleAreaChart,
  SimpleBarChart,
  SimpleLineChart,
  SleepStackedChart,
} from "./HealthCharts";
import HealthAnalyzeModal from "./HealthAnalyzeModal";
import { HealthAnalysesList, type HealthAnalysesListHandle } from "./HealthAnalysesList";

// ---- Typy ----
type DayPoint = { date: string; value: number; count: number };
type BpPoint = { date: string; systolic: number; diastolic: number };
type SleepPoint = { date: string; total: number; deep: number; rem: number; core: number; awake: number };

type Stats = {
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  latest: number | null;
  latestAt: string | null;
  trendPct: number | null;
};

type Summary = {
  from: string;
  to: string;
  series: Record<string, DayPoint[] | BpPoint[] | SleepPoint[]>;
  stats: Record<string, Stats | { systolic: Stats; diastolic: Stats } | { total: Stats; deep: Stats; rem: Stats }>;
  units: Record<string, string | null>;
};

// ---- Paleta ----
const TINT = {
  peach: "oklch(82% 0.12 45)",
  mint: "oklch(84% 0.10 165)",
  lavender: "oklch(80% 0.11 290)",
  sky: "oklch(82% 0.11 225)",
  sage: "oklch(84% 0.09 145)",
  butter: "oklch(88% 0.12 92)",
  rose: "oklch(82% 0.11 15)",
  pink: "oklch(82% 0.11 345)",
};

const PRESETS: { label: string; days: number }[] = [
  { label: "7 d", days: 7 },
  { label: "30 d", days: 30 },
  { label: "90 d", days: 90 },
  { label: "6 m", days: 180 },
  { label: "1 rok", days: 365 },
  { label: "vše", days: 9999 },
];

// ---- Helpers ----
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtNum(n: number | null, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("cs-CZ", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ---- Section tabs ----
type Section = "overview" | "activity" | "heart" | "sleep" | "body" | "pressure";

const SECTIONS: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Přehled", icon: Activity },
  { id: "activity", label: "Aktivita", icon: Footprints },
  { id: "heart", label: "Srdce", icon: HeartPulse },
  { id: "sleep", label: "Spánek", icon: Moon },
  { id: "body", label: "Tělo", icon: Scale },
  { id: "pressure", label: "Tlak", icon: Heart },
];

// ==========================================================================
export default function HealthDashboard() {
  const [from, setFrom] = useState<Date>(() => new Date(Date.now() - 30 * 86_400_000));
  const [to, setTo] = useState<Date>(() => new Date());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [preset, setPreset] = useState<number>(30);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const analysesListRef = useRef<HealthAnalysesListHandle | null>(null);

  async function load(f: Date, t: Date) {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/health/summary?from=${encodeURIComponent(f.toISOString())}&to=${encodeURIComponent(t.toISOString())}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Načtení selhalo.");
        return;
      }
      setSummary(data);
    } catch {
      setError("Síťová chyba.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(from, to); }, [from, to]);

  function applyPreset(days: number) {
    setPreset(days);
    const t = new Date();
    const f = new Date(t.getTime() - days * 86_400_000);
    setFrom(f);
    setTo(t);
  }

  function setCustomRange(newFrom: string, newTo: string) {
    setPreset(0);
    setFrom(new Date(newFrom));
    setTo(new Date(newTo));
  }

  return (
    <div className="space-y-5">
      {/* Date range controls + Analyze button */}
      <div className="glass rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
          Období
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.days)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                preset === p.days
                  ? "bg-white/15 text-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={isoDate(from)}
            onChange={(e) => setCustomRange(e.target.value, isoDate(to))}
            className="bg-white/5 border border-border rounded-md px-2 py-1 text-foreground font-mono"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={isoDate(to)}
            onChange={(e) => setCustomRange(isoDate(from), e.target.value)}
            className="bg-white/5 border border-border rounded-md px-2 py-1 text-foreground font-mono"
          />
        </div>
        <Button
          size="sm"
          onClick={() => setAnalyzeOpen(true)}
          className="ml-auto"
        >
          <Sparkles />
          Analyzovat
        </Button>
      </div>

      <HealthAnalyzeModal
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        onSaved={() => analysesListRef.current?.refresh()}
        initialFrom={from}
        initialTo={to}
      />

      {/* Section tabs */}
      <div className="glass rounded-xl p-2 flex flex-wrap gap-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                active
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      {loading && !summary && (
        <div className="glass rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Načítám data…
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {error}
          <Button variant="ghost" size="sm" onClick={() => load(from, to)} className="ml-2">
            Zkusit znovu
          </Button>
        </div>
      )}

      {summary && (
        <>
          {section === "overview" && <OverviewSection s={summary} />}
          {section === "activity" && <ActivitySection s={summary} />}
          {section === "heart" && <HeartSection s={summary} />}
          {section === "sleep" && <SleepSection s={summary} />}
          {section === "body" && <BodySection s={summary} />}
          {section === "pressure" && <PressureSection s={summary} />}
        </>
      )}

      {/* Uložené analýzy — vždy viditelné pod dashboardem, aby se k nim šlo vrátit */}
      <HealthAnalysesList ref={analysesListRef} />
    </div>
  );
}

// ==========================================================================
// KPI karta
function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tint,
  sub,
  trendPct,
  decimals = 0,
}: {
  label: string;
  value: number | null;
  unit?: string;
  icon: typeof Activity;
  tint: string;
  sub?: string;
  trendPct?: number | null;
  decimals?: number;
}) {
  const trendLabel =
    trendPct == null
      ? null
      : trendPct > 2
      ? { icon: ArrowUpRight, text: `+${trendPct.toFixed(1)} %`, color: TINT.sage }
      : trendPct < -2
      ? { icon: ArrowDownRight, text: `${trendPct.toFixed(1)} %`, color: TINT.rose }
      : { icon: Minus, text: "stabilní", color: TINT.sky };

  return (
    <article
      className="glass rounded-xl p-4 relative overflow-hidden"
      style={{ ["--c" as string]: tint }}
    >
      <div
        className="absolute -top-10 -right-10 size-24 rounded-full blur-2xl pointer-events-none"
        style={{ background: "color-mix(in oklch, var(--c) 25%, transparent)" }}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted-foreground">
          {label}
        </span>
        <div
          className="size-7 rounded-md grid place-items-center"
          style={{
            background: "color-mix(in oklch, var(--c) 15%, transparent)",
            color: "var(--c)",
          }}
        >
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="font-serif text-[2rem] leading-none mt-2 tabular">
        {fmtNum(value, decimals)}
        {unit && <span className="text-sm text-muted-foreground ml-1 font-sans">{unit}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {sub && <span>{sub}</span>}
        {trendLabel && (
          <span className="inline-flex items-center gap-1 ml-auto font-mono tabular" style={{ color: trendLabel.color }}>
            <trendLabel.icon className="size-3" />
            {trendLabel.text}
          </span>
        )}
      </div>
    </article>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  tint,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tint: string;
}) {
  return (
    <div
      className="glass rounded-xl p-4"
      style={{ ["--c" as string]: tint }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-serif text-lg" style={{ color: "var(--c)" }}>{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground font-mono mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ==========================================================================
// --- Přehled (KPI grid) ---
function OverviewSection({ s }: { s: Summary }) {
  const get = (type: string) => (s.stats[type] as Stats) ?? null;
  const bpStats = s.stats.blood_pressure as { systolic: Stats; diastolic: Stats } | undefined;
  const sleepStats = s.stats.sleep_analysis as { total: Stats; deep: Stats; rem: Stats } | undefined;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Průměr kroky"
          value={get("step_count")?.avg ?? null}
          icon={Footprints}
          tint={TINT.peach}
          trendPct={get("step_count")?.trendPct ?? null}
          sub={`${get("step_count")?.count ?? 0} dní`}
        />
        <KpiCard
          label="Klidový tep"
          value={get("resting_heart_rate")?.avg ?? null}
          unit="bpm"
          icon={HeartPulse}
          tint={TINT.rose}
          trendPct={get("resting_heart_rate")?.trendPct ?? null}
          decimals={0}
        />
        <KpiCard
          label="HRV průměr"
          value={get("heart_rate_variability")?.avg ?? null}
          unit="ms"
          icon={Activity}
          tint={TINT.lavender}
          trendPct={get("heart_rate_variability")?.trendPct ?? null}
          decimals={1}
        />
        <KpiCard
          label="Spánek průměr"
          value={sleepStats?.total.avg ?? null}
          unit="h"
          icon={Moon}
          tint={TINT.sky}
          trendPct={sleepStats?.total.trendPct ?? null}
          decimals={1}
        />
        <KpiCard
          label="Aktivní energie"
          value={get("active_energy")?.avg ?? null}
          unit="kJ / den"
          icon={Flame}
          tint={TINT.butter}
          trendPct={get("active_energy")?.trendPct ?? null}
        />
        <KpiCard
          label="Vzdálenost"
          value={get("walking_running_distance")?.avg ?? null}
          unit="km / den"
          icon={TrendingUp}
          tint={TINT.mint}
          decimals={2}
          trendPct={get("walking_running_distance")?.trendPct ?? null}
        />
        <KpiCard
          label="Schody"
          value={get("flights_climbed")?.avg ?? null}
          unit="pater"
          icon={Mountain}
          tint={TINT.sage}
          trendPct={get("flights_climbed")?.trendPct ?? null}
        />
        <KpiCard
          label="Poslední tlak"
          value={bpStats?.systolic.latest ?? null}
          unit={bpStats?.diastolic.latest ? `/ ${fmtNum(bpStats.diastolic.latest)}` : ""}
          icon={Heart}
          tint={TINT.pink}
          sub={bpStats?.systolic.latestAt ? new Date(bpStats.systolic.latestAt).toLocaleDateString("cs-CZ") : undefined}
        />
      </section>

      {/* Overview charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Kroky" subtitle="denní součet" tint={TINT.peach}>
          <SimpleBarChart
            data={(s.series.step_count as DayPoint[]) ?? []}
            color={TINT.peach}
            label="Kroky"
          />
        </ChartCard>

        <ChartCard title="HRV" subtitle="denní průměr, ms" tint={TINT.lavender}>
          <SimpleLineChart
            data={(s.series.heart_rate_variability as DayPoint[]) ?? []}
            color={TINT.lavender}
            unit="ms"
            decimals={1}
            label="HRV"
          />
        </ChartCard>

        <ChartCard title="Spánek" subtitle="fáze po nocích" tint={TINT.sky}>
          <SleepStackedChart data={(s.series.sleep_analysis as SleepPoint[]) ?? []} />
        </ChartCard>

        <ChartCard title="Klidový tep" subtitle="bpm" tint={TINT.rose}>
          <SimpleLineChart
            data={(s.series.resting_heart_rate as DayPoint[]) ?? []}
            color={TINT.rose}
            unit="bpm"
            label="Klidový tep"
          />
        </ChartCard>
      </section>
    </div>
  );
}

// --- Aktivita ---
function ActivitySection({ s }: { s: Summary }) {
  const steps = (s.series.step_count as DayPoint[]) ?? [];
  const energy = (s.series.active_energy as DayPoint[]) ?? [];
  const distance = (s.series.walking_running_distance as DayPoint[]) ?? [];
  const flights = (s.series.flights_climbed as DayPoint[]) ?? [];
  const exercise = (s.series.apple_exercise_time as DayPoint[]) ?? [];
  const stand = (s.series.apple_stand_time as DayPoint[]) ?? [];
  const get = (type: string) => (s.stats[type] as Stats) ?? null;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Kroky / den" value={get("step_count")?.avg ?? null} icon={Footprints} tint={TINT.peach} trendPct={get("step_count")?.trendPct ?? null} />
        <KpiCard label="Kalorie aktiv." value={get("active_energy")?.avg ?? null} unit="kJ" icon={Flame} tint={TINT.butter} trendPct={get("active_energy")?.trendPct ?? null} />
        <KpiCard label="Vzdálenost" value={get("walking_running_distance")?.avg ?? null} unit="km" icon={TrendingUp} tint={TINT.mint} decimals={2} trendPct={get("walking_running_distance")?.trendPct ?? null} />
        <KpiCard label="Cvičení" value={get("apple_exercise_time")?.avg ?? null} unit="min" icon={Timer} tint={TINT.sage} trendPct={get("apple_exercise_time")?.trendPct ?? null} />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Kroky" subtitle="denní součet" tint={TINT.peach}>
          <SimpleBarChart data={steps} color={TINT.peach} label="Kroky" />
        </ChartCard>
        <ChartCard title="Aktivní energie" subtitle="kJ / den" tint={TINT.butter}>
          <SimpleAreaChart data={energy} color={TINT.butter} unit="kJ" label="kJ" />
        </ChartCard>
        <ChartCard title="Vzdálenost" subtitle="km / den" tint={TINT.mint}>
          <SimpleAreaChart data={distance} color={TINT.mint} unit="km" decimals={2} label="km" />
        </ChartCard>
        <ChartCard title="Patra" subtitle="počet za den" tint={TINT.sage}>
          <SimpleBarChart data={flights} color={TINT.sage} label="Pater" />
        </ChartCard>
        <ChartCard title="Cvičení" subtitle="minuty" tint={TINT.peach}>
          <SimpleBarChart data={exercise} color={TINT.peach} unit="min" label="Cvičení" />
        </ChartCard>
        <ChartCard title="Stání" subtitle="minuty / hodiny" tint={TINT.sky}>
          <SimpleBarChart data={stand} color={TINT.sky} unit="min" label="Stání" />
        </ChartCard>
      </section>
    </div>
  );
}

// --- Srdce ---
function HeartSection({ s }: { s: Summary }) {
  const get = (type: string) => (s.stats[type] as Stats) ?? null;
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Klidový tep" value={get("resting_heart_rate")?.avg ?? null} unit="bpm" icon={HeartPulse} tint={TINT.rose} trendPct={get("resting_heart_rate")?.trendPct ?? null} />
        <KpiCard label="HRV průměr" value={get("heart_rate_variability")?.avg ?? null} unit="ms" icon={Activity} tint={TINT.lavender} decimals={1} trendPct={get("heart_rate_variability")?.trendPct ?? null} />
        <KpiCard label="Dech. frekv." value={get("respiratory_rate")?.avg ?? null} unit="/min" icon={Wind} tint={TINT.sky} decimals={1} trendPct={get("respiratory_rate")?.trendPct ?? null} />
        <KpiCard label="Cardio recovery" value={get("cardio_recovery")?.avg ?? null} unit="bpm" icon={Heart} tint={TINT.sage} decimals={0} />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Klidový tep" subtitle="bpm" tint={TINT.rose}>
          <SimpleLineChart data={(s.series.resting_heart_rate as DayPoint[]) ?? []} color={TINT.rose} unit="bpm" label="Klidový tep" />
        </ChartCard>
        <ChartCard title="HRV" subtitle="ms" tint={TINT.lavender}>
          <SimpleLineChart data={(s.series.heart_rate_variability as DayPoint[]) ?? []} color={TINT.lavender} unit="ms" decimals={1} label="HRV" />
        </ChartCard>
        <ChartCard title="Dechová frekvence" subtitle="/ min" tint={TINT.sky}>
          <SimpleLineChart data={(s.series.respiratory_rate as DayPoint[]) ?? []} color={TINT.sky} unit="/min" decimals={1} label="Dechy" />
        </ChartCard>
        <ChartCard title="Cardio recovery" subtitle="bpm po 1 min" tint={TINT.sage}>
          <SimpleBarChart data={(s.series.cardio_recovery as DayPoint[]) ?? []} color={TINT.sage} unit="bpm" label="Recovery" />
        </ChartCard>
      </section>
    </div>
  );
}

// --- Spánek ---
function SleepSection({ s }: { s: Summary }) {
  const sleepStats = s.stats.sleep_analysis as { total: Stats; deep: Stats; rem: Stats } | undefined;
  const points = (s.series.sleep_analysis as SleepPoint[]) ?? [];
  const totals = useMemo(() => points.map((p) => ({ date: p.date, value: p.total })), [points]);
  const deeps = useMemo(() => points.map((p) => ({ date: p.date, value: p.deep })), [points]);
  const rems = useMemo(() => points.map((p) => ({ date: p.date, value: p.rem })), [points]);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Celkem" value={sleepStats?.total.avg ?? null} unit="h" icon={Moon} tint={TINT.sky} decimals={1} trendPct={sleepStats?.total.trendPct ?? null} />
        <KpiCard label="Hluboký" value={sleepStats?.deep.avg ?? null} unit="h" icon={Bed} tint={TINT.lavender} decimals={1} trendPct={sleepStats?.deep.trendPct ?? null} />
        <KpiCard label="REM" value={sleepStats?.rem.avg ?? null} unit="h" icon={Activity} tint={TINT.mint} decimals={1} trendPct={sleepStats?.rem.trendPct ?? null} />
        <KpiCard label="Nocí v období" value={sleepStats?.total.count ?? 0} icon={Moon} tint={TINT.peach} />
      </section>
      <section className="grid grid-cols-1 gap-3">
        <ChartCard title="Fáze spánku" subtitle="stacked per noc, hodiny" tint={TINT.sky}>
          <SleepStackedChart data={points} />
        </ChartCard>
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ChartCard title="Celkový spánek" subtitle="hodiny" tint={TINT.sky}>
          <SimpleAreaChart data={totals} color={TINT.sky} unit="h" decimals={1} label="Spánek" />
        </ChartCard>
        <ChartCard title="Hluboký spánek" subtitle="hodiny" tint={TINT.lavender}>
          <SimpleAreaChart data={deeps} color={TINT.lavender} unit="h" decimals={1} label="Hluboký" />
        </ChartCard>
        <ChartCard title="REM" subtitle="hodiny" tint={TINT.mint}>
          <SimpleAreaChart data={rems} color={TINT.mint} unit="h" decimals={1} label="REM" />
        </ChartCard>
      </section>
    </div>
  );
}

// --- Tělo ---
function BodySection({ s }: { s: Summary }) {
  const get = (type: string) => (s.stats[type] as Stats) ?? null;
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Váha (poslední)" value={get("weight_body_mass")?.latest ?? null} unit="kg" icon={Scale} tint={TINT.lavender} decimals={1} />
        <KpiCard label="Váha průměr" value={get("weight_body_mass")?.avg ?? null} unit="kg" icon={Scale} tint={TINT.lavender} decimals={1} trendPct={get("weight_body_mass")?.trendPct ?? null} />
        <KpiCard label="Tělesný tuk" value={get("body_fat_percentage")?.latest ?? null} unit="%" icon={Flame} tint={TINT.peach} decimals={1} />
        <KpiCard label="Délka kroku" value={get("walking_step_length")?.avg ?? null} unit="cm" icon={Footprints} tint={TINT.mint} decimals={1} />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Váha" subtitle="kg" tint={TINT.lavender}>
          <SimpleLineChart data={(s.series.weight_body_mass as DayPoint[]) ?? []} color={TINT.lavender} unit="kg" decimals={1} label="Váha" />
        </ChartCard>
        <ChartCard title="Délka kroku" subtitle="cm" tint={TINT.mint}>
          <SimpleLineChart data={(s.series.walking_step_length as DayPoint[]) ?? []} color={TINT.mint} unit="cm" decimals={1} label="Délka" />
        </ChartCard>
      </section>
    </div>
  );
}

// --- Krevní tlak ---
function PressureSection({ s }: { s: Summary }) {
  const points = (s.series.blood_pressure as BpPoint[]) ?? [];
  const bpStats = s.stats.blood_pressure as { systolic: Stats; diastolic: Stats } | undefined;
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Systolický Ø" value={bpStats?.systolic.avg ?? null} unit="mmHg" icon={Heart} tint={TINT.rose} trendPct={bpStats?.systolic.trendPct ?? null} />
        <KpiCard label="Diastolický Ø" value={bpStats?.diastolic.avg ?? null} unit="mmHg" icon={Heart} tint={TINT.pink} trendPct={bpStats?.diastolic.trendPct ?? null} />
        <KpiCard label="Systolický max" value={bpStats?.systolic.max ?? null} unit="mmHg" icon={ArrowUpRight} tint={TINT.butter} />
        <KpiCard label="Měření" value={bpStats?.systolic.count ?? 0} icon={Activity} tint={TINT.sage} sub="v období" />
      </section>
      <ChartCard title="Krevní tlak" subtitle="systolic (rose) + diastolic (pink)" tint={TINT.rose}>
        <BloodPressureChart data={points} systolicColor={TINT.rose} diastolicColor={TINT.pink} />
      </ChartCard>
    </div>
  );
}
