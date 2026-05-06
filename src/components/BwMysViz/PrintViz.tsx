/**
 * Print-optimized varianta vizualizací — fixed rozměry (Recharts ResponsiveContainer
 * v print preview má jinak 0×0). Sjednocuje SixHatsRadar + MoodCurve + EntryTypesDonut
 * + ArgumentsGrid + DecisionCompass do jednoho gridu pro tisknutelnou stránku.
 */
import SixHatsRadar from "./SixHatsRadar";
import MoodCurve from "./MoodCurve";
import EntryTypesDonut from "./EntryTypesDonut";
import ArgumentsGrid, { type DecisionArgument } from "./ArgumentsGrid";
import DecisionCompass from "./DecisionCompass";

interface Entry {
  datum: string;
  nalada: number;
  typVstupu: string;
  uhelPohledu: string;
  uhelPohleduAi?: string | null;
  obsah: string;
}

interface Props {
  entries: Entry[];
  args: DecisionArgument[];
  decisionStatus: string;
}

const TILE_STYLE: React.CSSProperties = {
  background: "white",
  border: "1px solid #e0e0e0",
  borderRadius: 6,
  padding: 8,
  pageBreakInside: "avoid",
  breakInside: "avoid",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#666",
  fontFamily: "ui-monospace, monospace",
  marginBottom: 4,
};

export default function BwMysPrintViz({ entries, args, decisionStatus }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Compass — full width, primární viz */}
      {args.length > 0 && (
        <div style={{ ...TILE_STYLE, padding: 12 }}>
          <div style={LABEL_STYLE}>Decision Compass — kde rozhodnutí stojí</div>
          <div style={{ height: 360 }}>
            <DecisionCompass args={args} decisionStatus={decisionStatus} />
          </div>
        </div>
      )}

      {/* 2×2 grid menších grafů */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Six Hats — pokrytí úhlů</div>
          <div style={{ height: 220 }}>
            <SixHatsRadar entries={entries} />
          </div>
        </div>

        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Křivka nálad v čase</div>
          <div style={{ height: 220 }}>
            <MoodCurve entries={entries} />
          </div>
        </div>

        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Distribuce typů zápisů</div>
          <div style={{ height: 220 }}>
            <EntryTypesDonut entries={entries} />
          </div>
        </div>

        {args.length > 0 && (
          <div style={TILE_STYLE}>
            <div style={LABEL_STYLE}>Mřížka argumentů (smer × konzistence)</div>
            <div style={{ height: 220 }}>
              <ArgumentsGrid arguments={args} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
