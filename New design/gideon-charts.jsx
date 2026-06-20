/* ──────────────────────────────────────────────────────────
   Gideon / MediaFace Admin · Charts
   Pure-SVG, token-driven, no dependencies. Pixel-measured so
   strokes never distort and tooltips land exactly on points.
   Exports: LineChart, BarChart, Sparkline, Donut
   ──────────────────────────────────────────────────────── */
const { useRef: chUseRef, useState: chUseState, useLayoutEffect: chUseLayout } = React;

/* measure container width in px (keeps SVG 1:1 with the box) */
function useWidth(ref) {
  const [w, setW] = chUseState(0);
  chUseLayout(() => {
    if (!ref.current) return;
    const el = ref.current;
    const set = () => setW(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/* ── LINE / AREA CHART (1+ series) ──────────────────────── */
function LineChart({ series, labels, height = 190, unit = '', area = true, yTicks = 4, formatV }) {
  const wrap = chUseRef(null);
  const W = useWidth(wrap);
  const [hi, setHi] = chUseState(null);
  const fmt = formatV || (v => v.toLocaleString('cs-CZ'));

  const pl = 38, pr = 14, pt = 16, pb = 26;
  const plotW = Math.max(0, W - pl - pr);
  const plotH = height - pt - pb;
  const n = labels.length;
  const allVals = series.flatMap(s => s.values);
  const max = niceMax(Math.max(...allVals, 1));
  const x = i => pl + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = v => pt + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (max / yTicks) * i);

  const linePath = vals => vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const areaPath = vals => linePath(vals) + ` L${x(n - 1).toFixed(1)} ${(pt + plotH).toFixed(1)} L${x(0).toFixed(1)} ${(pt + plotH).toFixed(1)} Z`;

  return (
    <div className="chart2" ref={wrap} style={{ position: 'relative' }}>
      <svg width={W} height={height} role="img" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={'lg' + si} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || 'var(--c-signal)'} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color || 'var(--c-signal)'} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {/* grid + y labels */}
        {W > 0 && ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} y1={y(t)} x2={W - pr} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={pl - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fontFamily='"JetBrains Mono", monospace' fill="var(--text-3)">{Math.round(t)}</text>
          </g>
        ))}
        {/* x labels */}
        {W > 0 && labels.map((l, i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fontFamily='"JetBrains Mono", monospace' fill="var(--text-3)">{l}</text>
        ))}
        {/* areas + lines */}
        {W > 0 && series.map((s, si) => (
          <g key={si}>
            {area && !s.dashed && <path d={areaPath(s.values)} fill={`url(#lg${si})`} />}
            <path d={linePath(s.values)} fill="none" stroke={s.color || 'var(--c-signal)'} strokeWidth={s.dashed ? 1.6 : 2.4}
              strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 4' : 'none'} opacity={s.dashed ? 0.7 : 1} />
          </g>
        ))}
        {/* hover guide + dots */}
        {W > 0 && hi != null && (
          <g>
            <line x1={x(hi)} y1={pt} x2={x(hi)} y2={pt + plotH} stroke="var(--line-3)" strokeWidth="1" strokeDasharray="3 3" />
            {series.map((s, si) => (
              <circle key={si} cx={x(hi)} cy={y(s.values[hi])} r="4" fill="var(--surface)" stroke={s.color || 'var(--c-signal)'} strokeWidth="2.2" />
            ))}
          </g>
        )}
        {/* always show last-point dot of primary series */}
        {W > 0 && hi == null && series.filter(s => !s.dashed).map((s, si) => (
          <circle key={si} cx={x(n - 1)} cy={y(s.values[n - 1])} r="3.5" fill={s.color || 'var(--c-signal)'} />
        ))}
        {/* hover zones */}
        {W > 0 && labels.map((l, i) => (
          <rect key={i} x={x(i) - plotW / (n - 1) / 2} y={pt} width={plotW / (n - 1)} height={plotH} fill="transparent"
            onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: 'crosshair' }} />
        ))}
      </svg>
      {hi != null && W > 0 && (
        <div className="chart-tip" style={{ left: (x(hi) / W * 100) + '%', top: pt - 6 }}>
          <div className="ct-x">{labels[hi]}</div>
          {series.map((s, si) => (
            <div className="ct-row" key={si}>
              <span className="ct-dot" style={{ background: s.color || 'var(--c-signal)' }} />
              <span className="ct-name">{s.name}</span>
              <span className="ct-val">{fmt(s.values[hi])}{unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── BAR CHART ──────────────────────────────────────────── */
function BarChart({ data, height = 190, unit = '', color = 'var(--c-signal)', highlightMax = true, yTicks = 4, formatV }) {
  const wrap = chUseRef(null);
  const W = useWidth(wrap);
  const [hi, setHi] = chUseState(null);
  const fmt = formatV || (v => v.toLocaleString('cs-CZ'));
  const pl = 38, pr = 14, pt = 16, pb = 26;
  const plotW = Math.max(0, W - pl - pr), plotH = height - pt - pb;
  const n = data.length;
  const max = niceMax(Math.max(...data.map(d => d.value), 1));
  const maxV = Math.max(...data.map(d => d.value));
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (max / yTicks) * i);
  const slot = n ? plotW / n : 0;
  const bw = Math.min(34, slot * 0.56);
  const y = v => pt + plotH - (v / max) * plotH;

  return (
    <div className="chart2" ref={wrap} style={{ position: 'relative' }}>
      <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {W > 0 && ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} y1={y(t)} x2={W - pr} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={pl - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fontFamily='"JetBrains Mono", monospace' fill="var(--text-3)">{Math.round(t)}</text>
          </g>
        ))}
        {W > 0 && data.map((d, i) => {
          const cx = pl + slot * i + slot / 2;
          const on = hi === i || (hi == null && highlightMax && d.value === maxV);
          return (
            <g key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: 'pointer' }}>
              <rect x={cx - slot / 2} y={pt} width={slot} height={plotH} fill="transparent" />
              <rect x={cx - bw / 2} y={y(d.value)} width={bw} height={pt + plotH - y(d.value)} rx="5"
                fill={on ? color : `color-mix(in srgb, ${color} 32%, var(--surface-3))`} style={{ transition: 'fill .12s' }} />
              <text x={cx} y={height - 8} textAnchor="middle" fontSize="10.5" fontFamily='"JetBrains Mono", monospace' fill="var(--text-3)">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hi != null && W > 0 && (
        <div className="chart-tip" style={{ left: ((pl + slot * hi + slot / 2) / W * 100) + '%', top: pt - 6 }}>
          <div className="ct-x">{data[hi].label}</div>
          <div className="ct-row"><span className="ct-dot" style={{ background: color }} /><span className="ct-val">{fmt(data[hi].value)}{unit}</span></div>
        </div>
      )}
    </div>
  );
}

/* ── SPARKLINE (tiny inline line, no axes) ──────────────── */
function Sparkline({ values, height = 38, color = 'var(--c-signal)', area = true, strokeWidth = 1.8 }) {
  const wrap = chUseRef(null);
  const W = useWidth(wrap);
  const pad = 3;
  const n = values.length;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = i => pad + (i / (n - 1)) * (W - pad * 2);
  const y = v => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg width={W} height={height} style={{ display: 'block' }}>
        <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {W > 0 && area && <path d={line + ` L${x(n - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`} fill="url(#spk)" />}
        {W > 0 && <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />}
        {W > 0 && <circle cx={x(n - 1)} cy={y(values[n - 1])} r="2.6" fill={color} />}
      </svg>
    </div>
  );
}

/* ── DONUT / RING ───────────────────────────────────────── */
function Donut({ data, size = 168, thickness = 22, centerLabel, centerSub, legend = true }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none', transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * c;
          const seg = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.c || 'var(--c-signal)'} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-acc * c} strokeLinecap="butt" />
          );
          acc += frac;
          return seg;
        })}
        {centerLabel != null && (
          <g transform={`rotate(90 ${size / 2} ${size / 2})`}>
            <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)" letterSpacing="-0.03em">{centerLabel}</text>
            {centerSub && <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="11" fontFamily='"JetBrains Mono", monospace' fill="var(--text-3)">{centerSub}</text>}
          </g>
        )}
      </svg>
      {legend && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 130 }}>
          {data.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: d.c || 'var(--c-signal)', flex: 'none' }} />
              <span style={{ color: 'var(--text-2)', flex: 1 }}>{d.label}</span>
              <span className="mono" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 12.5 }}>{Math.round(d.value / total * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LineChart, BarChart, Sparkline, Donut });
