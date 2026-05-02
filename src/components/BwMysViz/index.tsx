import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import SixHatsRadar from "./SixHatsRadar";
import MoodCurve from "./MoodCurve";
import EntryTypesDonut from "./EntryTypesDonut";

interface Entry {
  datum: string;
  nalada: number;
  typVstupu: string;
  uhelPohledu: string;
  uhelPohleduAi?: string | null;
  obsah: string;
}

export default function BwMysViz({ entries, defaultOpen = true }: { entries: Entry[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="glass rounded-xl p-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm w-full"
      >
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        <span className="font-mono uppercase text-xs tracking-widest text-muted-foreground">
          Vizuální přehled
        </span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Tile title="Six Hats — pokrytí úhlů">
            <SixHatsRadar entries={entries} />
          </Tile>
          <Tile title="Křivka nálad v čase">
            <MoodCurve entries={entries} />
          </Tile>
          <Tile title="Distribuce typů zápisů" full>
            <EntryTypesDonut entries={entries} />
          </Tile>
        </div>
      )}
    </div>
  );
}

function Tile({ title, full, children }: { title: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-md border border-white/5 bg-white/[0.02] p-3 ${full ? "md:col-span-2" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
