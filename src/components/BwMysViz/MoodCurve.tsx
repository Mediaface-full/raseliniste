import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import { MOOD_COLORS, MOOD_LABEL } from "../../lib/bwmys-colors";

interface Entry {
  datum: string;
  nalada: number;
  obsah: string;
}

interface Point {
  idx: number;
  nalada: number;
  datum: string;
  preview: string;
}

function CustomDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={MOOD_COLORS[payload.nalada] ?? "#888"}
      stroke="rgba(255,255,255,0.4)"
      strokeWidth={1}
    />
  );
}

export default function MoodCurve({ entries }: { entries: Entry[] }) {
  const data = useMemo<Point[]>(
    () =>
      entries.map((e, i) => ({
        idx: i + 1,
        nalada: e.nalada,
        datum: new Date(e.datum).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" }),
        preview: e.obsah.slice(0, 50) + (e.obsah.length > 50 ? "…" : ""),
      })),
    [entries]
  );

  if (entries.length < 2) {
    return (
      <div className="text-xs text-muted-foreground italic h-48 grid place-items-center text-center px-4">
        Pro křivku nálad jsou potřeba alespoň 2 zápisy.
      </div>
    );
  }

  const min = Math.min(...entries.map((e) => e.nalada));
  const max = Math.max(...entries.map((e) => e.nalada));
  const swing = max - min;

  return (
    <div className="flex flex-col">
      <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="datum" stroke="#888" fontSize={10} />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} stroke="#888" fontSize={10} />
          <ReferenceLine y={3} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />
          <Tooltip
            contentStyle={{ background: "#0c1126", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 12, maxWidth: 240 }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload[0]) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="rounded-md border border-white/10 bg-[#0c1126] p-2 text-xs max-w-[220px]">
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {p.datum} · nálada {p.nalada} ({MOOD_LABEL[p.nalada]})
                  </div>
                  <div className="mt-1 text-foreground/85">{p.preview}</div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="nalada"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1.5}
            dot={<CustomDot />}
            activeDot={{ r: 7 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
      {swing >= 3 && (
        <div className="text-[10px] font-mono text-[var(--tint-butter)] text-center pt-1">
          ⚠ velký výkyv nálady ({min}→{max}) — náladově skreslené?
        </div>
      )}
    </div>
  );
}
