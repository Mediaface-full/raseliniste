import { useMemo } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { effectiveUhel, UHEL_LABEL_SHORT } from "../../lib/bwmys-colors";

interface Entry {
  uhelPohledu: string;
  uhelPohleduAi?: string | null;
}

const HATS_ORDER = ["fakta", "emoce", "kritika", "prinosy", "alternativy", "meta"];

export default function SixHatsRadar({ entries }: { entries: Entry[] }) {
  const data = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(HATS_ORDER.map((h) => [h, 0]));
    for (const e of entries) {
      const uhel = effectiveUhel(e.uhelPohledu, e.uhelPohleduAi);
      if (uhel && uhel in counts) counts[uhel]++;
    }
    return HATS_ORDER.map((h) => ({
      uhel: UHEL_LABEL_SHORT[h] ?? h,
      count: counts[h],
    }));
  }, [entries]);

  const classified = entries.filter((e) => effectiveUhel(e.uhelPohledu, e.uhelPohleduAi)).length;
  const missing = HATS_ORDER.filter((h) => !data.find((d) => d.uhel === UHEL_LABEL_SHORT[h])?.count);

  if (classified === 0) {
    return (
      <div className="text-xs text-muted-foreground italic h-48 grid place-items-center">
        Zatím žádné klasifikované úhly pohledu.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex flex-col">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="75%">
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis dataKey="uhel" tick={{ fill: "#aaa", fontSize: 10 }} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, max]}
              tick={{ fill: "#666", fontSize: 9 }}
              tickCount={Math.min(max + 1, 5)}
            />
            <Radar
              dataKey="count"
              stroke="var(--tint-sky)"
              fill="var(--tint-sky)"
              fillOpacity={0.35}
            />
            <Tooltip
              contentStyle={{ background: "#0c1126", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 12 }}
              formatter={(v) => [`${v}× zápis`, ""]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {missing.length > 0 && (
        <div className="text-[10px] font-mono text-[var(--tint-butter)]/80 text-center pt-1">
          chybí: {missing.map((h) => UHEL_LABEL_SHORT[h]).join(" · ")}
        </div>
      )}
    </div>
  );
}
