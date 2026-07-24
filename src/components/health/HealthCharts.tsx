import type { ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Petr 2026-07-24: osy byly hardcoded bílé — ve světlém režimu neviditelné.
// var(--muted-foreground) funguje v obou režimech.
const axisProps = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  tickLine: false,
  axisLine: { stroke: "color-mix(in oklch, var(--foreground) 15%, transparent)" },
};

const gridProps = {
  stroke: "color-mix(in oklch, var(--foreground) 8%, transparent)",
  strokeDasharray: "3 3",
  vertical: false,
};

function formatDay(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

function TooltipCard(props: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; unit?: string }>;
  label?: string;
  suffix?: string;
  decimals?: number;
  /** Petr 2026-07-24: u měření s časovou složkou (krevní tlak) ukázat i čas */
  withTime?: boolean;
}): ReactElement | null {
  const { active, payload, label, suffix, decimals = 0, withTime } = props;
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="glass-strong rounded-md px-3 py-2 text-xs">
      <div className="font-mono text-muted-foreground mb-1">
        {label
          ? new Date(label).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" }) +
            (withTime ? ` · ${new Date(label).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false })}` : "")
          : ""}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 tabular">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground">{p.name}:</span>
          <span className="font-mono">
            {p.value.toFixed(decimals)}
            {suffix ? ` ${suffix}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Line chart ----
export function SimpleLineChart({
  data,
  dataKey,
  color,
  unit,
  decimals = 0,
  label = "Hodnota",
}: {
  data: Array<{ date: string; value: number }>;
  dataKey?: string;
  color: string;
  unit?: string;
  decimals?: number;
  label?: string;
}) {
  const key = dataKey ?? "value";
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={formatDay} {...axisProps} />
        <YAxis {...axisProps} domain={["auto", "auto"]} />
        <Tooltip content={<TooltipCard suffix={unit} decimals={decimals} />} />
        <Line
          type="monotone"
          dataKey={key}
          name={label}
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---- Area chart (pro cumulative daily sums — kroky, kalorie) ----
export function SimpleAreaChart({
  data,
  color,
  unit,
  decimals = 0,
  label = "Hodnota",
}: {
  data: Array<{ date: string; value: number }>;
  color: string;
  unit?: string;
  decimals?: number;
  label?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${color.slice(-10)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={formatDay} {...axisProps} />
        <YAxis {...axisProps} domain={["auto", "auto"]} />
        <Tooltip content={<TooltipCard suffix={unit} decimals={decimals} />} />
        <Area
          type="monotone"
          dataKey="value"
          name={label}
          stroke={color}
          strokeWidth={2}
          fill={`url(#g-${color.slice(-10)})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---- Bar chart pro denní součty (kroky, atd.) ----
export function SimpleBarChart({
  data,
  color,
  unit,
  decimals = 0,
  label = "Hodnota",
}: {
  data: Array<{ date: string; value: number }>;
  color: string;
  unit?: string;
  decimals?: number;
  label?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={formatDay} {...axisProps} />
        <YAxis {...axisProps} domain={["auto", "auto"]} />
        <Tooltip content={<TooltipCard suffix={unit} decimals={decimals} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="value" name={label} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- Dual line pro krevní tlak (systolic + diastolic) ----
export function BloodPressureChart({
  data,
  systolicColor,
  diastolicColor,
}: {
  data: Array<{ date: string; systolic: number; diastolic: number }>;
  systolicColor: string;
  diastolicColor: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={formatDay} {...axisProps} />
        <YAxis {...axisProps} domain={[50, 160]} />
        <Tooltip content={<TooltipCard suffix="mmHg" decimals={0} withTime />} />
        <Line type="monotone" dataKey="systolic" name="Systolic" stroke={systolicColor} strokeWidth={2} dot={{ r: 3, fill: systolicColor, strokeWidth: 0 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="diastolic" name="Diastolic" stroke={diastolicColor} strokeWidth={2} dot={{ r: 3, fill: diastolicColor, strokeWidth: 0 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---- Sleep stacked bar (core/deep/rem/awake per noc) ----
export function SleepStackedChart({
  data,
}: {
  data: Array<{ date: string; deep: number; rem: number; core: number; awake: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" tickFormatter={formatDay} {...axisProps} />
        <YAxis {...axisProps} domain={[0, "auto"]} />
        <Tooltip content={<TooltipCard suffix="h" decimals={1} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="deep" stackId="sleep" name="Deep" fill="oklch(60% 0.13 290)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="core" stackId="sleep" name="Core" fill="oklch(75% 0.09 250)" isAnimationActive={false} />
        <Bar dataKey="rem" stackId="sleep" name="REM" fill="oklch(80% 0.11 225)" isAnimationActive={false} />
        <Bar dataKey="awake" stackId="sleep" name="Awake" fill="oklch(78% 0.09 40)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
