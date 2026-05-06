/**
 * Decision Compass — 5. vizualizační komponenta v B&W Myš.
 *
 * SVG kompas se 4 kvadranty zobrazující kde se rozhodnutí opírá:
 *   - SZ (smer<0, konz>0.5) — silný signál PROTI
 *   - SV (smer>0, konz>0.5) — silný signál PRO
 *   - JZ (smer<0, konz<0.5) — šum strach
 *   - JV (smer>0, konz<0.5) — šum euforie
 *
 * Argumenty s vysokou konzistencí (signál, horní polovina) jsou plné.
 * Argumenty s nízkou konzistencí (šum, dolní polovina) jsou vybledlé + dashed.
 *
 * V centru kompasu = aktuální verdikt + label "opřený o sever/východ/jih/západ".
 *
 * Spec: INSTRUKCE/zadani-decision-compass.pdf (květen 2026).
 */

import { COMPASS_HAT_COLORS } from "../../lib/bwmys-colors";
import type { DecisionArgument } from "./ArgumentsGrid";

// SVG layout
const VIEW_W = 680;
const VIEW_H = 600;
const X_CENTER = 340;
const X_RANGE = 300;
const Y_CENTER = 300;
const Y_RANGE = 240;

// Mapování dat → souřadnice
function mapX(smer: number): number {
  return X_CENTER + smer * X_RANGE; // smer -1 → 40, +1 → 640
}
function mapY(konzistence: number): number {
  // konz 1.0 → y 60 (top, signál); konz 0.5 → y 300; konz 0.0 → y 540 (bottom, šum)
  return Y_CENTER + (0.5 - konzistence) * 2 * Y_RANGE;
}
function mapRadius(cetnost: number): number {
  return Math.min(32, 10 + cetnost * 2);
}

// Verdikt mapping
const VERDIKT_MAP: Record<string, { text: string; color: string }> = {
  aktivni: { text: "verdikt: čeká", color: "#A0522D" },
  uzavrene_jdu: { text: "verdikt: jdu", color: "#0F6E56" },
  uzavrene_nejdu: { text: "verdikt: nejdu", color: "#993556" },
  odlozene: { text: "verdikt: odložit", color: "#854F0B" },
  archivovane: { text: "verdikt: archiv", color: "#5C5650" },
};

// Kvadrant labels — pro subtext "opřený o ..."
type Quadrant = "sever" | "vychod" | "jih" | "zapad";

function quadrantWeight(args: ArgWithHat[]): Record<Quadrant, number> {
  const w: Record<Quadrant, number> = { sever: 0, vychod: 0, jih: 0, zapad: 0 };
  for (const a of args) {
    const weight = a.cetnost * Math.abs(a.smer);
    const isSignal = a.konzistence > 0.5;
    const isPro = a.smer > 0;
    if (isSignal && !isPro) w.sever += weight;     // SZ
    else if (isSignal && isPro) w.vychod += weight; // SV
    else if (!isSignal && !isPro) w.zapad += weight; // JZ
    else if (!isSignal && isPro) w.jih += weight;   // JV
  }
  return w;
}

function dominantQuadrant(args: ArgWithHat[]): { label: string; weak: boolean } {
  const w = quadrantWeight(args);
  const max = Math.max(w.sever, w.vychod, w.jih, w.zapad);
  if (max < 5) return { label: "slabý signál", weak: true };
  let dominant: Quadrant = "sever";
  for (const k of ["sever", "vychod", "jih", "zapad"] as Quadrant[]) {
    if (w[k] === max) { dominant = k; break; }
  }
  return { label: `opřený o ${dominant}`, weak: false };
}

// Argument may have klobouk (rozšířené schéma) — fallback na "meta" pro legacy data.
type ArgWithHat = DecisionArgument & { klobouk?: string };

function hatColor(klobouk?: string): string {
  if (klobouk && COMPASS_HAT_COLORS[klobouk]) return COMPASS_HAT_COLORS[klobouk];
  return COMPASS_HAT_COLORS.meta;
}

export default function DecisionCompass({
  args,
  decisionStatus,
}: {
  args: ArgWithHat[];
  decisionStatus: string;
}) {
  const verdikt = VERDIKT_MAP[decisionStatus] ?? VERDIKT_MAP.aktivni;
  const dominance = dominantQuadrant(args ?? []);

  if (!args || args.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic h-48 grid place-items-center">
        Zatím žádné argumenty.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Decision Compass — vizualizace argumentů ve 4 kvadrantech"
    >
      <defs>
        <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>

      {/* 1. Pozadí kvadrantů */}
      {/* SZ — silný signál PROTI (mírně zelený nádech) */}
      <rect x={40} y={60} width={300} height={240} fill="rgba(15, 110, 86, 0.04)" />
      {/* SV — silný signál PRO (mírně zelený nádech) */}
      <rect x={340} y={60} width={300} height={240} fill="rgba(15, 110, 86, 0.04)" />
      {/* JZ — šum strach (mírně červený nádech) */}
      <rect x={40} y={300} width={300} height={240} fill="rgba(153, 53, 86, 0.03)" />
      {/* JV — šum euforie (mírně červený nádech) */}
      <rect x={340} y={300} width={300} height={240} fill="rgba(153, 53, 86, 0.03)" />

      {/* 2. Osy */}
      <line x1={40} y1={300} x2={640} y2={300} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
      <line x1={340} y1={60} x2={340} y2={540} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

      {/* 3. Středový kruh */}
      <circle cx={X_CENTER} cy={Y_CENTER} r={50} fill="url(#centerGlow)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3 3" />

      {/* 4. Popisky kvadrantů */}
      <g fontFamily="ui-sans-serif, system-ui, sans-serif">
        {/* SZ */}
        <text x={50} y={80} fill="rgba(255,255,255,0.7)" fontSize={11} fontWeight={600} letterSpacing={1}>SILNÝ SIGNÁL — PROTI</text>
        <text x={50} y={94} fill="rgba(255,255,255,0.45)" fontSize={9}>konzistentní napříč náladami</text>
        {/* SV */}
        <text x={490} y={80} fill="rgba(255,255,255,0.7)" fontSize={11} fontWeight={600} letterSpacing={1}>SILNÝ SIGNÁL — PRO</text>
        <text x={490} y={94} fill="rgba(255,255,255,0.45)" fontSize={9}>konzistentní napříč náladami</text>
        {/* JZ */}
        <text x={50} y={528} fill="rgba(255,255,255,0.5)" fontSize={11} fontWeight={600} letterSpacing={1}>ŠUM — STRACH</text>
        <text x={50} y={514} fill="rgba(255,255,255,0.35)" fontSize={9}>jen v náladě 1–2</text>
        {/* JV */}
        <text x={490} y={528} fill="rgba(255,255,255,0.5)" fontSize={11} fontWeight={600} letterSpacing={1}>ŠUM — EUFORIE</text>
        <text x={490} y={514} fill="rgba(255,255,255,0.35)" fontSize={9}>jen v náladě 4–5</text>
      </g>

      {/* 5. Popisky os */}
      <g fontFamily="ui-monospace, monospace" fontSize={9} fill="rgba(255,255,255,0.4)" letterSpacing={1}>
        {/* PROTI / PRO na konci horizontální osy */}
        <text x={48} y={296} textAnchor="start">← PROTI</text>
        <text x={632} y={296} textAnchor="end">PRO →</text>
        {/* Vertikální popis — rotované */}
        <text transform={`translate(28, 80) rotate(-90)`} textAnchor="end">vysoká konzistence ↑</text>
        <text transform={`translate(28, 540) rotate(-90)`} textAnchor="start">↓ náladově zkreslené</text>
      </g>

      {/* 6. Legenda velikosti — nahoře uprostřed */}
      <g transform={`translate(${X_CENTER - 90}, 22)`} fontFamily="ui-monospace, monospace" fontSize={9} fill="rgba(255,255,255,0.5)">
        <text x={0} y={4} textAnchor="end">četnost:</text>
        <circle cx={20} cy={0} r={mapRadius(2)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" />
        <text x={20} y={26} textAnchor="middle">2×</text>
        <circle cx={70} cy={0} r={mapRadius(6)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" />
        <text x={70} y={26} textAnchor="middle">6×</text>
        <circle cx={140} cy={0} r={mapRadius(12)} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" />
        <text x={140} y={26} textAnchor="middle">12×</text>
      </g>

      {/* 7. Body argumentů */}
      {args.map((a, i) => {
        const cx = mapX(a.smer);
        const cy = mapY(a.konzistence);
        const r = mapRadius(a.cetnost);
        const isSignal = a.konzistence > 0.5;
        const fill = hatColor(a.klobouk);
        return (
          <g key={i} opacity={isSignal ? 1.0 : 0.55}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
              fillOpacity={isSignal ? 0.85 : 0.5}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={1}
              strokeDasharray={isSignal ? undefined : "2 2"}
            />
            {/* Číslo "n×" uvnitř */}
            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
              fontSize={Math.min(11, r * 0.55)}
              fill="white"
              fontWeight={600}
            >
              {a.cetnost}×
            </text>
            {/* Popisek argumentu pod kuličkou */}
            <text
              x={cx}
              y={cy + r + 12}
              textAnchor="middle"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize={9}
              fill="rgba(255,255,255,0.7)"
            >
              {a.argument.length > 28 ? a.argument.slice(0, 26) + "…" : a.argument}
            </text>
          </g>
        );
      })}

      {/* 8. Verdikt v centru */}
      <g>
        <circle cx={X_CENTER} cy={Y_CENTER - 8} r={6} fill={verdikt.color} stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
        <text
          x={X_CENTER}
          y={Y_CENTER + 12}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize={14}
          fill="rgba(255,255,255,0.95)"
          fontWeight={500}
        >
          {verdikt.text}
        </text>
        <text
          x={X_CENTER}
          y={Y_CENTER + 28}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill={dominance.weak ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.6)"}
          fontStyle={dominance.weak ? "italic" : undefined}
        >
          {dominance.label}
        </text>
      </g>

      {/* 9. Legenda klobouků dole */}
      <g transform={`translate(40, 568)`} fontFamily="ui-monospace, monospace" fontSize={9} fill="rgba(255,255,255,0.6)">
        {(["fakta", "emoce", "kritika", "prinosy", "alternativy", "meta"] as const).map((h, i) => (
          <g key={h} transform={`translate(${i * 100}, 0)`}>
            <circle cx={4} cy={-3} r={4} fill={COMPASS_HAT_COLORS[h]} fillOpacity={0.85} stroke="rgba(255,255,255,0.3)" />
            <text x={12} y={0}>{h}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
