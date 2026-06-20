/* Gideon Admin · icons + UI primitives */
const { useState: gUseState, useRef: gUseRef, useEffect: gUseEffect } = React;

const GIc = {
  grid:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>,
  users:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M17 4.5a3.5 3.5 0 0 1 0 7M21 20v-1a5 5 0 0 0-4-4.9"/></svg>,
  folder: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  invoice:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>,
  spark:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="2.5"/></svg>,
  mail:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
  doc:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M7 3h7l5 5v13H7z" transform="translate(-1 0)"/><path d="M13 3v5h5M9 13h6M9 17h6"/></svg>,
  cog:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z" transform="scale(.82) translate(2.6 2.6)"/></svg>,
  search: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  bell:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>,
  sun:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  moon:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>,
  plus:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14"/></svg>,
  x:      (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>,
  chevron:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m6 9 6 6 6-6"/></svg>,
  chevR:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m9 6 6 6-6 6"/></svg>,
  check:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5"/></svg>,
  arrowUp:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 19V5M6 11l6-6 6 6"/></svg>,
  arrowDn:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M6 13l6 6 6-6"/></svg>,
  edit:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>,
  trash:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>,
  more:   (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>,
  menu:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>,
  phone:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>,
  pin:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>,
  cal:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>,
  upload: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>,
  logout: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>,
  ext:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>,
  chart:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>,
  history:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2"/></svg>,
  files:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 3v5h5"/><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5z"/></svg>,
};

function money(n) { return (n || 0).toLocaleString('cs-CZ') + ' Kč'; }
function gFmtDate(iso) {
  if (!iso || iso === '—') return '—';
  const d = new Date(iso); if (isNaN(d)) return iso;
  return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
}

function GAvatar({ who, size, sq }) {
  const u = (window.GideonData.G_USERS[who]) || { color: 'var(--ph-archive)', name: who };
  const init = (window.GideonData.G_USERS[who]) ? who : (who || '?').slice(0, 2).toUpperCase();
  const st = {
    background: `color-mix(in srgb, ${u.color} 20%, var(--surface))`,
    color: 'var(--text)',
    boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${u.color} 55%, transparent)`,
  };
  const cls = sq ? 'av-lg' : ('ava' + (size === 'sm' ? ' ava--sm' : size === 'lg' ? ' ava--lg' : ''));
  return <span className={cls} style={st} title={u.name}>{init}</span>;
}

const STATUS_MAP = {
  active:  { t: 'Aktivní',     c: 'ok' },
  lead:    { t: 'Lead',        c: 'info' },
  paused:  { t: 'Pozastaveno', c: 'warn' },
  archived:{ t: 'Archiv',      c: 'muted' },
  review:  { t: 'Ke schválení',c: 'warn' },
  done:    { t: 'Hotovo',      c: 'ok' },
  paid:    { t: 'Zaplaceno',   c: 'ok' },
  sent:    { t: 'Odesláno',    c: 'info' },
  overdue: { t: 'Po splatnosti', c: 'danger' },
  draft:   { t: 'Koncept',     c: 'muted' },
};
function StatusBadge({ status, label }) {
  const s = STATUS_MAP[status] || { t: label || status, c: 'muted' };
  return <span className={'st st--' + s.c}><span className="d" />{label || s.t}</span>;
}

/* ── Select (shadcn) ── */
function GSelect({ value, options, onChange, render, placeholder }) {
  const [open, setOpen] = gUseState(false);
  const ref = gUseRef(null);
  gUseEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const cur = options.find(o => o.value === value);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="in" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: cur ? 'var(--text)' : 'var(--muted)' }}>{cur ? (render ? render(cur) : cur.label) : (placeholder || 'Vyber…')}</span>
        <GIc.chevron style={{ width: 16, height: 16, opacity: .5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 80,
          background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: '10px', boxShadow: 'var(--shadow-pop)', padding: '5px', maxHeight: 260, overflowY: 'auto' }}>
          {options.map(o => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', textAlign: 'left', border: 0,
                background: o.value === value ? 'var(--surface-2)' : 'transparent', color: 'var(--text)', fontSize: 14, padding: '9px 11px', borderRadius: 7 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = o.value === value ? 'var(--surface-2)' : 'transparent'}>
              {render ? render(o) : o.label}
              {o.value === value && <GIc.check style={{ width: 14, height: 14, marginLeft: 'auto', color: 'var(--c-signal)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Switch({ on, onChange }) {
  return <button type="button" className={'sw' + (on ? ' on' : '')} role="switch" aria-checked={on} onClick={() => onChange(!on)} />;
}

function SegRadio({ value, options, onChange }) {
  return (
    <div className="seg-radio">
      {options.map(o => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function FileDrop({ hint }) {
  const [over, setOver] = gUseState(false);
  return (
    <div className={'filedrop' + (over ? ' over' : '')}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); }}>
      <div className="ic"><GIc.upload /></div>
      <div className="t1">Přetáhni soubory nebo <b>vyber z disku</b></div>
      <div className="t2">{hint || 'PDF, PNG, JPG, DOCX · max 20 MB'}</div>
    </div>
  );
}

function TagsField({ tags, onChange, placeholder }) {
  const [v, setV] = gUseState('');
  const add = () => { const t = v.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setV(''); };
  return (
    <div>
      {tags.length > 0 && (
        <div className="tags-wrap" style={{ marginBottom: 10 }}>
          {tags.map(t => <span className="tag" key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => onChange(tags.filter(x => x !== t))}>{t}<GIc.x style={{ width: 11, height: 11 }} /></span>)}
        </div>
      )}
      <input className="in" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={placeholder || 'Napiš a stiskni Enter'} />
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.key} className={active === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <span className="ct">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { GIc, money, gFmtDate, GAvatar, StatusBadge, GSelect, Switch, SegRadio, FileDrop, TagsField, Tabs, STATUS_MAP });
