import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { TYPE_COLORS, TYPE_LABEL } from "../../lib/bwmys-colors";

interface Entry {
  typVstupu: string;
}

const TYPE_ORDER = ["novy_fakt_zvenci", "nova_uvaha", "napadlo_me", "reakce_na_udalost"];

export default function EntryTypesDonut({ entries }: { entries: Entry[] }) {
  const { data, total, comment } = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
    for (const e of entries) {
      if (e.typVstupu in counts) counts[e.typVstupu]++;
    }
    const total = entries.length;
    const data = TYPE_ORDER
      .map((t) => ({ key: t, name: TYPE_LABEL[t] ?? t, value: counts[t] }))
      .filter((d) => d.value > 0);

    let comment: string | null = null;
    if (total > 0) {
      const fakta = counts["novy_fakt_zvenci"] / total;
      const uvahy = (counts["nova_uvaha"] + counts["napadlo_me"]) / total;
      if (fakta < 0.2 && uvahy > 0.6) {
        comment = "Převažují vlastní úvahy — málo nových faktů zvenčí.";
      } else if (fakta > 0.5) {
        comment = "Hodně nových faktů zvenčí — solidní podklad.";
      }
    }
    return { data, total, comment };
  }, [entries]);

  if (entries.length < 3) {
    return (
      <div className="text-xs text-muted-foreground italic h-48 grid place-items-center text-center px-4">
        Pro distribuci typů jsou potřeba alespoň 3 zápisy.
      </div>
    );
  }

  return (
    <div className="h-56 relative">
      <ResponsiveContainer width="100%" height="85%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={TYPE_COLORS[d.key] ?? "#888"} stroke="rgba(0,0,0,0.3)" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#0c1126", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 12 }}
            formatter={(v, n) => [`${Number(v)}× (${Math.round((Number(v) / total) * 100)} %)`, String(n)]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none" style={{ height: "85%" }}>
        <div className="text-center">
          <div className="font-serif text-2xl">{total}</div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">zápisů</div>
        </div>
      </div>
      {comment && (
        <div className="text-[10px] font-mono text-muted-foreground text-center px-2 pt-1">
          {comment}
        </div>
      )}
    </div>
  );
}
