/**
 * Print-optimized varianta vizualizací s EXPLICIT page-break strategií.
 *
 * Layout pro A4 portrait (cca 720 × 1020 px content area při 12mm margin):
 *   - Compass na vlastní stránce (full A4)
 *   - 2×2 grafů na vlastní stránce
 *
 * Recharts ResponsiveContainer v print preview má 0×0 — proto explicit pixel
 * dimensions na všechny chart wrappery. width/height musí být v PX, ne %.
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

// A4 portrait s 12mm margin → content cca 720 × 1020 px (96 dpi)
const PAGE_W = 720;
const COMPASS_H = 540;
const SMALL_W = 350; // (720 - 20 gap) / 2
const SMALL_H = 280;

const TILE_STYLE: React.CSSProperties = {
  background: "white",
  border: "1px solid #d8d8d8",
  borderRadius: 6,
  padding: 10,
  pageBreakInside: "avoid",
  breakInside: "avoid",
  overflow: "hidden",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9.5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#555",
  fontFamily: "ui-monospace, monospace",
  marginBottom: 6,
  fontWeight: 600,
};

export default function BwMysPrintViz({ entries, args, decisionStatus }: Props) {
  return (
    <div className="print-viz-wrap">
      {/* PAGE: Decision Compass — full A4 portrait */}
      {args.length > 0 && (
        <div className="page-section" style={{ ...TILE_STYLE, padding: 14, width: PAGE_W }}>
          <div style={LABEL_STYLE}>Decision Compass — kde rozhodnutí stojí</div>
          <div style={{ width: PAGE_W - 28, height: COMPASS_H }}>
            <DecisionCompass args={args} decisionStatus={decisionStatus} />
          </div>
        </div>
      )}

      {/* PAGE-BREAK before grids */}
      <div className="page-break" />

      {/* 2×2 grid menších grafů — vejdou se na 1 A4 stranu */}
      <div
        className="page-section"
        style={{
          display: "grid",
          gridTemplateColumns: `${SMALL_W}px ${SMALL_W}px`,
          gap: 20,
          width: PAGE_W,
        }}
      >
        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Six Hats — pokrytí úhlů</div>
          <div style={{ width: SMALL_W - 22, height: SMALL_H }}>
            <SixHatsRadar entries={entries} />
          </div>
        </div>

        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Křivka nálad v čase</div>
          <div style={{ width: SMALL_W - 22, height: SMALL_H }}>
            <MoodCurve entries={entries} />
          </div>
        </div>

        <div style={TILE_STYLE}>
          <div style={LABEL_STYLE}>Distribuce typů zápisů</div>
          <div style={{ width: SMALL_W - 22, height: SMALL_H }}>
            <EntryTypesDonut entries={entries} />
          </div>
        </div>

        {args.length > 0 && (
          <div style={TILE_STYLE}>
            <div style={LABEL_STYLE}>Mřížka argumentů (smer × konzistence)</div>
            <div style={{ width: SMALL_W - 22, height: SMALL_H }}>
              <ArgumentsGrid arguments={args} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
