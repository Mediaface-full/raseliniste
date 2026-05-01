import { useEffect, useState } from "react";
import { Loader2, Plus, Archive, Briefcase, Heart, Layers, Clock, MessageSquarePlus } from "lucide-react";
import { Button } from "./ui/Button";

interface DecisionListItem {
  id: string;
  nazev: string;
  otazka: string;
  kontext: string;
  status: string;
  deadlineRozhodnuti: string;
  datumVytvoreni: string;
  delkaSberuDny: number;
  _count: { entries: number; evaluations: number };
}

const KONTEXT_META: Record<string, { label: string; icon: typeof Briefcase; tint: string }> = {
  pracovni: { label: "Pracovní", icon: Briefcase, tint: "sky" },
  osobni: { label: "Osobní", icon: Heart, tint: "rose" },
  smiseny: { label: "Smíšený", icon: Layers, tint: "lavender" },
};

const MIN_FOR_FINAL = 5;

export default function BwMysList() {
  const [items, setItems] = useState<DecisionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/bwmys");
      const data = await res.json();
      if (res.ok) setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function daysToDeadline(d: string): number {
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  }

  if (loading) {
    return <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Načítám…
    </div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="text-sm text-muted-foreground flex-1">
          {items.length} aktivní rozhodnut{items.length === 1 ? "í" : items.length < 5 ? "í" : "í"}
        </div>
        <Button variant="outline" onClick={() => (window.location.href = "/bwmys/archiv")}>
          <Archive /> Archiv
        </Button>
        <Button onClick={() => (window.location.href = "/bwmys/nove")}>
          <Plus /> Nové rozhodnutí
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">
          Žádná aktivní rozhodnutí. Nové založ klikem výše.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => {
            const meta = KONTEXT_META[it.kontext] ?? KONTEXT_META.smiseny;
            const Icon = meta.icon;
            const days = daysToDeadline(it.deadlineRozhodnuti);
            const ready = it._count.entries >= MIN_FOR_FINAL;
            return (
              <a
                key={it.id}
                href={`/bwmys/${it.id}`}
                className="glass rounded-xl p-4 hover:bg-white/5 transition-colors block"
                style={{ ["--c" as string]: `var(--tint-${meta.tint})` }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="size-10 rounded-md grid place-items-center shrink-0"
                    style={{ background: "color-mix(in oklch, var(--c) 18%, transparent)", color: "var(--c)" }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{it.nazev}</div>
                    <div className="text-xs text-muted-foreground/90 italic mt-0.5 line-clamp-2">
                      {it.otazka}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[11px] font-mono">
                      <span className={ready ? "text-[var(--tint-sage)]" : "text-muted-foreground"}>
                        <MessageSquarePlus className="inline size-3 mr-0.5" />
                        {it._count.entries} / {MIN_FOR_FINAL}
                      </span>
                      <span className={days < 0 ? "text-destructive" : days < 3 ? "text-[var(--tint-butter)]" : "text-muted-foreground"}>
                        <Clock className="inline size-3 mr-0.5" />
                        {days < 0 ? `po deadline o ${-days}d` : `${days}d do deadline`}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
