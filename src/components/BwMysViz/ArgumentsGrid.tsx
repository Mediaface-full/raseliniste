import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { ARGUMENT_COLORS, MOOD_COLORS } from "../../lib/bwmys-colors";

export interface DecisionArgument {
  argument: string;
  smer: number;            // -1..+1
  konzistence: number;     // 0..1
  cetnost: number;
  nalady_vyskytu: number[];
  // Six Hats kategorie — přidáno pro Decision Compass (zadani-decision-compass.pdf, květen 2026).
  // Optional kvůli backwards compatibility se starými argumentsJson v DB.
  klobouk?: "fakta" | "emoce" | "kritika" | "prinosy" | "alternativy" | "meta";
}

interface Point extends DecisionArgument {
  fill: string;
  opacity: number;
}

export default function ArgumentsGrid({ arguments: args }: { arguments: DecisionArgument[] }) {
  if (!args || args.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic h-48 grid place-items-center">
        Žádné argumenty se nepodařilo extrahovat.
      </div>
    );
  }

  // Velikost bodu spočítáme přímo z četnosti — Recharts ZAxis/node.z je
  // nedokumentovaný a v různých verzích se chová jinak. Tohle je deterministické.
  const maxCetnost = Math.max(...args.map((a) => a.cetnost), 1);
  const data: Point[] = args.map((a) => ({
    ...a,
    fill: a.smer >= 0 ? ARGUMENT_COLORS.pro : ARGUMENT_COLORS.proti,
    opacity: a.konzistence >= 0.5 ? 1 : 0.4,
  }));

  function radiusFor(cetnost: number): number {
    // 5 px (cetnost=1) až 14 px (max). Lineární po sqrt aby plocha rostla úměrně počtu.
    const norm = Math.sqrt(cetnost / maxCetnost);
    return 5 + norm * 9;
  }

  return (
    <div className="space-y-2">
      <div className="h-72 relative">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              dataKey="smer"
              domain={[-1, 1]}
              ticks={[-1, -0.5, 0, 0.5, 1]}
              stroke="#888"
              fontSize={10}
              label={{ value: "← proti  ·  pro →", position: "insideBottom", offset: -10, fill: "#888", fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="konzistence"
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              stroke="#888"
              fontSize={10}
              label={{ value: "konzistence ↑", angle: -90, position: "insideLeft", offset: 12, fill: "#888", fontSize: 10 }}
            />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
            <ReferenceLine y={0.5} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.15)" }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null;
                const p = payload[0].payload as Point;
                return (
                  <div className="rounded-md border border-white/10 bg-[#0c1126] p-2 text-xs max-w-[260px]">
                    <div className="font-medium text-foreground/90">{p.argument}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">
                      směr {p.smer.toFixed(2)} · konzistence {p.konzistence.toFixed(2)} · {p.cetnost}× zápis
                    </div>
                    {p.nalady_vyskytu.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {p.nalady_vyskytu.map((n, i) => (
                          <span key={i} className="size-2.5 rounded-full" style={{ background: MOOD_COLORS[n] }} title={`nálada ${n}`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Scatter
              data={data}
              shape={(props: unknown) => {
                const p = props as { cx: number; cy: number; payload: Point };
                return (
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={radiusFor(p.payload.cetnost)}
                    fill={p.payload.fill}
                    fillOpacity={p.payload.opacity}
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={0.5}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground/80 px-1">
        <div className="text-left">↖ Tvrdé proti</div>
        <div className="text-right">Tvrdé pro ↗</div>
        <div className="text-left">↙ Náladově proti</div>
        <div className="text-right">Náladově pro ↘</div>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground/70 text-center pt-1">
        velikost = četnost · plné = napříč náladami · průhledné = jen v určité náladě
      </div>
    </div>
  );
}
