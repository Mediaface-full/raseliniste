/* Gideon Admin · Component library (gallery) + extra primitives */
const { useState: cUseState, useRef: cUseRef, useEffect: cUseEffect } = React;

/* extra icons for this page */
const CIc = {
  info:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>,
  ok:     (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2L15.5 9.5"/></svg>,
  warn:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>,
  danger: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>,
  eye:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7S19 19 12 19 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  lock:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>,
  minus:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><path d="M5 12h14"/></svg>,
};

/* ── PRIMITIVES ─────────────────────────────────────────── */
function Checkbox({ checked, indeterminate, onChange, label, sub, disabled }) {
  return (
    <label className={'cbx' + (checked ? ' on' : '') + (indeterminate ? ' ind' : '') + (disabled ? ' disabled' : '')}>
      <span className="box" onClick={() => !disabled && onChange && onChange(!checked)}>{checked && !indeterminate && <GIc.check />}</span>
      {label && <span className="ctxt">{label}{sub && <span className="sub">{sub}</span>}</span>}
    </label>
  );
}
function Radio({ checked, onChange, label, sub }) {
  return (
    <label className={'rdo' + (checked ? ' on' : '')} onClick={onChange}>
      <span className="dot" />
      {label && <span className="ctxt">{label}{sub && <span className="sub">{sub}</span>}</span>}
    </label>
  );
}
function Slider({ value, min = 0, max = 100, step = 1, onChange, unit }) {
  return (
    <div className="rng-row">
      <input type="range" className="rng" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
      <span className="val">{value}{unit || ''}</span>
    </div>
  );
}
function Stepper({ value, onChange, min = 0, max = 999 }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))}><CIc.minus /></button>
      <input value={value} onChange={e => { const n = parseInt(e.target.value || 0, 10); if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n))); }} />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))}><GIc.plus /></button>
    </div>
  );
}
function Alert({ kind, title, children }) {
  const I = { info: CIc.info, ok: CIc.ok, warn: CIc.warn, danger: CIc.danger }[kind] || CIc.info;
  return (
    <div className={'alert alert--' + kind}>
      <I className="ai" />
      <div><div className="ttl">{title}</div>{children && <div className="msg">{children}</div>}</div>
    </div>
  );
}
function Tooltip({ text, children }) {
  return <span className="tip">{children}<span className="bub">{text}</span></span>;
}
function MultiSelect({ values, options, onChange, placeholder }) {
  const [open, setOpen] = cUseState(false);
  const ref = cUseRef(null);
  cUseEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const toggle = (v) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="in" onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 8, minHeight: 44 }}>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {values.length === 0 && <span style={{ color: 'var(--muted)' }}>{placeholder || 'Vyber…'}</span>}
          {values.map(v => <span className="tag" key={v} style={{ padding: '2px 8px' }}>{(options.find(o => o.value === v) || {}).label}</span>)}
        </span>
        <GIc.chevron style={{ width: 16, height: 16, opacity: .5, flex: 'none' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 80, background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: 5, maxHeight: 240, overflowY: 'auto' }}>
          {options.map(o => (
            <button key={o.value} type="button" onClick={() => toggle(o.value)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: 'var(--text)', fontSize: 14, padding: '9px 10px', borderRadius: 7 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span className={'cbx' + (values.includes(o.value) ? ' on' : '')} style={{ pointerEvents: 'none' }}><span className="box">{values.includes(o.value) && <GIc.check />}</span></span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Stars({ value, onChange }) {
  return (
    <span className="stars" style={{ fontSize: 20, letterSpacing: 4, cursor: onChange ? 'pointer' : 'default', display: 'inline-flex' }}>
      {[1, 2, 3, 4, 5].map(i => <span key={i} className={i <= value ? '' : 'off'} onClick={() => onChange && onChange(i)}>★</span>)}
    </span>
  );
}

/* ── GALLERY PAGE ───────────────────────────────────────── */
function ComponentsPage() {
  const [cb, setCb] = cUseState({ a: true, b: false, c: true });
  const [rg, setRg] = cUseState('mid');
  const [rc, setRc] = cUseState('team');
  const [sw, setSw] = cUseState(true);
  const [seg, setSeg] = cUseState('board');
  const [sel, setSel] = cUseState('CZK');
  const [ms, setMs] = cUseState(['web', 'saas']);
  const [sl, setSl] = cUseState(60);
  const [num, setNum] = cUseState(14);
  const [tags, setTags] = cUseState(['web', 'údržba']);
  const [tab, setTab] = cUseState('a');
  const [star, setStar] = cUseState(4);
  const [pw, setPw] = cUseState(false);
  const [qScale, setQScale] = cUseState(4);
  const [qNps, setQNps] = cUseState(9);
  const [qYesno, setQYesno] = cUseState('yes');
  const [qStar, setQStar] = cUseState(0);

  const Sec = ({ id, num, title, children }) => (
    <section className="kit-sec" id={id}>
      <div className="kit-sec__head"><span className="num">{num}</span><h3>{title}</h3></div>
      <div className="kit-sec__body">{children}</div>
    </section>
  );
  const Cell = ({ label, children }) => (<div className="kit-cell"><span className="cl">{label}</span>{children}</div>);

  const anchors = [
    ['buttons', 'Tlačítka'], ['inputs', 'Pole'], ['select', 'Výběr'], ['check', 'Zaškrtávátka'],
    ['radio', 'Radio'], ['toggle', 'Přepínače'], ['slider', 'Slider'], ['tags', 'Tagy'],
    ['status', 'Stavy'], ['avatars', 'Avatary'], ['rating', 'Hodnocení'], ['survey', 'Dotazník'], ['tabs', 'Taby'],
    ['progress', 'Progress'], ['charts', 'Grafy'], ['alerts', 'Alerty'], ['misc', 'Ostatní'], ['colors', 'Barvy'],
  ];

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Design systém</div><h1>Komponenty</h1><p>Knihovna prvků administrace — zaškrtávátka, selecty, radia, slidery, tlačítka, stavy a další. Vše na gide-on tokenech, v light i dark.</p></div>
      </div>

      <div className="kit-anchor">
        {anchors.map(([id, l]) => <a key={id} href={'#' + id}>{l}</a>)}
      </div>

      <div className="kit">
        <Sec id="buttons" num="01" title="Tlačítka">
          <div className="kit-grid">
            <Cell label="Varianty"><div className="kit-row"><button className="b b--primary">Primární</button><button className="b b--outline">Outline</button><button className="b b--ghost">Ghost</button><button className="b b--danger">Smazat</button></div></Cell>
            <Cell label="S ikonou"><div className="kit-row"><button className="b b--primary"><GIc.plus />Nový</button><button className="b b--outline"><GIc.upload />Export</button></div></Cell>
            <Cell label="Velikosti"><div className="kit-row"><button className="b b--primary b--sm">Malé</button><button className="b b--primary">Střední</button><button className="b b--primary b--lg">Velké</button></div></Cell>
            <Cell label="Stavy"><div className="kit-row"><button className="b b--primary"><span className="spin" />Ukládám…</button><button className="b b--outline" disabled>Disabled</button><button className="b b--outline b--icon"><GIc.more /></button></div></Cell>
          </div>
        </Sec>

        <Sec id="inputs" num="02" title="Vstupní pole">
          <div className="kit-grid">
            <Cell label="Text"><input className="in" defaultValue="gide-on s.r.o." /></Cell>
            <Cell label="S ikonou"><div className="in-icon"><GIc.search /><input className="in" placeholder="Hledat…" /></div></Cell>
            <Cell label="Heslo"><div className="in-icon"><CIc.lock /><input className="in" type={pw ? 'text' : 'password'} defaultValue="tajneheslo" style={{ paddingRight: 40 }} /><button onClick={() => setPw(p => !p)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'none', color: 'var(--text-3)' }}><CIc.eye style={{ width: 16, height: 16 }} /></button></div></Cell>
            <Cell label="Chybový stav"><input className="in err" defaultValue="neplatny-email" /><div className="err-txt"><CIc.danger style={{ width: 13, height: 13 }} />Zadej platný e-mail.</div></Cell>
            <Cell label="Disabled"><input className="in" defaultValue="Nelze upravit" disabled /></Cell>
            <Cell label="Číslo (stepper)"><Stepper value={num} onChange={setNum} /></Cell>
            <Cell label="Datum"><input className="in" type="date" defaultValue="2026-06-15" /></Cell>
            <Cell label="Textarea"><textarea className="in" rows="2" defaultValue="Víceřádková poznámka…" /></Cell>
          </div>
        </Sec>

        <Sec id="select" num="03" title="Výběr">
          <div className="kit-grid">
            <Cell label="Select (jeden)"><GSelect value={sel} onChange={setSel} options={[{ value: 'CZK', label: 'CZK · koruna' }, { value: 'EUR', label: 'EUR · euro' }, { value: 'USD', label: 'USD · dolar' }]} /></Cell>
            <Cell label="Select se stavem"><GSelect value={'active'} onChange={() => {}} options={[{ value: 'active', label: 'Aktivní' }, { value: 'lead', label: 'Lead' }]} render={o => <StatusBadge status={o.value} />} /></Cell>
            <Cell label="Multiselect"><MultiSelect values={ms} onChange={setMs} options={[{ value: 'web', label: 'Web' }, { value: 'saas', label: 'SaaS' }, { value: 'udrzba', label: 'Údržba' }, { value: 'eshop', label: 'E-shop' }]} placeholder="Vyber služby" /></Cell>
            <Cell label="Nativní select"><select className="in"><option>Praha</option><option>Brno</option><option>Ostrava</option></select></Cell>
          </div>
        </Sec>

        <Sec id="check" num="04" title="Zaškrtávátka">
          <div className="kit-grid">
            <Cell label="Skupina"><div className="opt-stack">
              <Checkbox checked={cb.a} onChange={v => setCb(s => ({ ...s, a: v }))} label="E-mail při aktivitě" />
              <Checkbox checked={cb.b} onChange={v => setCb(s => ({ ...s, b: v }))} label="Týdenní přehled" sub="Každé pondělí ráno" />
              <Checkbox checked={cb.c} onChange={v => setCb(s => ({ ...s, c: v }))} label="Upozornění po splatnosti" />
            </div></Cell>
            <Cell label="Stavy"><div className="opt-stack">
              <Checkbox checked={true} onChange={() => {}} label="Zaškrtnuto" />
              <Checkbox indeterminate={true} checked={true} onChange={() => {}} label="Částečně (indeterminate)" />
              <Checkbox checked={false} disabled label="Disabled" />
            </div></Cell>
            <Cell label="Jako karta"><div className="opt-stack">
              <label className={'choice' + (cb.a ? ' on' : '')} onClick={() => setCb(s => ({ ...s, a: !s.a }))}>
                <Checkbox checked={cb.a} onChange={() => {}} />
                <span className="ctxt" style={{ fontSize: 14 }}>Fakturovat automaticky<span className="sub" style={{ display: 'block', fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>Vystaví fakturu 1. v měsíci</span></span>
              </label>
            </div></Cell>
          </div>
        </Sec>

        <Sec id="radio" num="05" title="Přepínače (radio)">
          <div className="kit-grid">
            <Cell label="Skupina"><div className="opt-stack">
              {[['low', 'Nízká'], ['mid', 'Střední'], ['high', 'Vysoká']].map(([v, l]) => <Radio key={v} checked={rg === v} onChange={() => setRg(v)} label={l} />)}
            </div></Cell>
            <Cell label="S popisem"><div className="opt-stack">
              <Radio checked={rc === 'me'} onChange={() => setRc('me')} label="Jen já" sub="Vidí pouze tvůj účet" />
              <Radio checked={rc === 'team'} onChange={() => setRc('team')} label="Tým" sub="Vidí všichni v gide-on" />
            </div></Cell>
            <Cell label="Jako karty"><div className="opt-stack">
              {[['me', 'Soukromé'], ['team', 'Tým'], ['all', 'Veřejné']].map(([v, l]) => (
                <label key={v} className={'choice' + (rc === v ? ' on' : '')} onClick={() => setRc(v)}><Radio checked={rc === v} onChange={() => {}} /><span style={{ fontSize: 14 }}>{l}</span></label>
              ))}
            </div></Cell>
          </div>
        </Sec>

        <Sec id="toggle" num="06" title="Switche & segmenty">
          <div className="kit-grid">
            <Cell label="Switch"><div className="kit-row"><Switch on={sw} onChange={setSw} /><span style={{ fontSize: 13, color: 'var(--text-3)' }}>{sw ? 'Zapnuto' : 'Vypnuto'}</span></div></Cell>
            <Cell label="Segmentový (radio)"><SegRadio value={seg} onChange={setSeg} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} /></Cell>
            <Cell label="Segment · 3 možnosti"><SegRadio value={rc} onChange={setRc} options={[{ value: 'me', label: 'Já' }, { value: 'team', label: 'Tým' }, { value: 'all', label: 'Vše' }]} /></Cell>
            <Cell label="Filtr chip"><div className="kit-row"><button className="fchip on">Aktivní</button><button className="fchip">Leads</button><button className="fchip">Archiv</button></div></Cell>
          </div>
        </Sec>

        <Sec id="slider" num="07" title="Slider">
          <div className="kit-grid">
            <Cell label="Hodnota"><Slider value={sl} onChange={setSl} unit=" %" /></Cell>
            <Cell label="Rozpočet (krok 5k)"><Slider value={sl * 1000} min={0} max={120000} step={5000} onChange={v => setSl(v / 1000)} /></Cell>
          </div>
        </Sec>

        <Sec id="tags" num="08" title="Tagy & chips">
          <div className="kit-grid">
            <Cell label="Editovatelné tagy"><TagsField tags={tags} onChange={setTags} /></Cell>
            <Cell label="Statické"><div className="tags-wrap"><span className="tag">web</span><span className="tag">SaaS</span><span className="tag">B2B</span><span className="tag">recurring</span></div></Cell>
            <Cell label="Market badge"><div className="kit-row"><span className="mkt">CZ</span><span className="mkt">INT</span><span className="mkt">CZ+INT</span></div></Cell>
          </div>
        </Sec>

        <Sec id="status" num="09" title="Stavy & badge">
          <div className="kit-grid">
            <Cell label="Status badge"><div className="kit-row"><StatusBadge status="active" /><StatusBadge status="lead" /><StatusBadge status="paused" /><StatusBadge status="overdue" /><StatusBadge status="paid" /><StatusBadge status="draft" /></div></Cell>
            <Cell label="Phase pill (Hatch)"><div className="kit-row"><span className="st st--signal"><span className="d" />Jiskra</span><span className="st st--info"><span className="d" />Zkoumá se</span><span className="st st--ok"><span className="d" />Spouští se</span></div></Cell>
            <Cell label="Business model"><div className="kit-row"><span className="bm">SaaS</span><span className="bm">Služba</span><span className="bm">One-off</span></div></Cell>
          </div>
        </Sec>

        <Sec id="avatars" num="10" title="Avatary">
          <div className="kit-grid">
            <Cell label="Velikosti"><div className="kit-row"><GAvatar who="JP" size="sm" /><GAvatar who="DK" /><GAvatar who="LH" size="lg" /></div></Cell>
            <Cell label="Skupina"><div className="ava-group"><GAvatar who="JP" /><GAvatar who="DK" /><GAvatar who="LH" /><span className="ava" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>+3</span></div></Cell>
            <Cell label="Čtvercový (detail)"><span className="av-lg" style={{ background: 'var(--ph-spark)' }}>AM</span></Cell>
          </div>
        </Sec>

        <Sec id="rating" num="11" title="Hodnocení">
          <div className="kit-grid">
            <Cell label="Interaktivní"><div className="kit-row"><Stars value={star} onChange={setStar} /><span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{star} / 5</span></div></Cell>
            <Cell label="Náročnost"><div className="kit-row"><span className="diff"><i className="on" /><i className="on" /><i /></span><span style={{ fontSize: 13, color: 'var(--text-3)' }}>Střední</span></div></Cell>
          </div>
        </Sec>

        <Sec id="survey" num="12" title="Dotazníkové prvky">
          <div className="kit-grid">
            <Cell label="Škála 1–5">
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4,5].map(i => (
                  <button key={i} type="button" onClick={() => setQScale(i)}
                    style={{ flex: 1, aspectRatio: '1', borderRadius: 12, border: '1.5px solid', borderColor: qScale === i ? 'var(--c-signal)' : 'var(--line-2)', background: qScale === i ? 'var(--c-signal)' : 'var(--surface)', color: qScale === i ? '#fff' : 'var(--text-2)', fontFamily: '"JetBrains Mono", monospace', fontSize: 16, fontWeight: 600 }}>{i}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 11.5, color: 'var(--text-3)' }}><span>Nesrozumitelné</span><span>Naprosto jasné</span></div>
            </Cell>
            <Cell label="NPS 0–10">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[0,1,2,3,4,5,6,7,8,9,10].map(i => {
                  const col = i <= 6 ? 'var(--c-danger)' : i <= 8 ? 'var(--c-warn)' : 'var(--c-ok)';
                  return <button key={i} type="button" onClick={() => setQNps(i)} style={{ flex: '1 0 7%', minWidth: 30, aspectRatio: '1', borderRadius: 8, border: '1.5px solid', borderColor: qNps === i ? col : 'var(--line-2)', background: qNps === i ? col : 'var(--surface)', color: qNps === i ? '#fff' : 'var(--text-2)', fontFamily: '"JetBrains Mono", monospace', fontSize: 13, fontWeight: 600 }}>{i}</button>;
                })}
              </div>
            </Cell>
            <Cell label="Ano / Ne">
              <div style={{ display: 'flex', gap: 10 }}>
                {[['yes','Ano'],['no','Ne']].map(([v,l]) => (
                  <button key={v} type="button" onClick={() => setQYesno(v)} className={'b ' + (qYesno === v ? 'b--primary' : 'b--outline')} style={{ flex: 1, padding: '12px', fontSize: 14 }}>{l}</button>
                ))}
              </div>
            </Cell>
            <Cell label="Hvězdičky · výběr">
              <span className="stars" style={{ fontSize: 30, letterSpacing: 7, cursor: 'pointer', display: 'inline-flex' }}>
                {[1,2,3,4,5].map(i => <span key={i} className={i <= qStar ? '' : 'off'} onClick={() => setQStar(i)}>★</span>)}
              </span>
            </Cell>
          </div>
        </Sec>

        <Sec id="tabs" num="13" title="Taby">
          <div className="kit-cell"><Tabs tabs={[{ key: 'a', label: 'Přehled' }, { key: 'b', label: 'Projekty', count: 3 }, { key: 'c', label: 'Faktury', count: 5 }]} active={tab} onChange={setTab} /></div>
        </Sec>

        <Sec id="progress" num="14" title="Progress & meter">
          <div className="kit-grid">
            <Cell label="Meter 38 %"><div className="meter"><i style={{ width: '38%' }} /></div></Cell>
            <Cell label="Meter 100 %"><div className="meter"><i style={{ width: '100%', background: 'var(--c-ok)' }} /></div></Cell>
            <Cell label="Tenký s číslem"><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface-3)' }}><div style={{ width: '72%', height: '100%', borderRadius: 3, background: 'var(--c-signal)' }} /></div><span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>72%</span></div></Cell>
          </div>
        </Sec>

        <Sec id="charts" num="15" title="Grafy">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 26 }}>
            <Cell label="Liniový · 2 série">
              <div className="chart-legend" style={{ marginBottom: 6 }}>
                <span className="lg"><span className="sw" style={{ background: 'var(--c-signal)' }} />Letos</span>
                <span className="lg" style={{ color: 'var(--text-3)' }}><span className="sw dash" />Loni</span>
              </div>
              <LineChart labels={window.GideonData.REVENUE.map(r => r.m)} unit=" tis."
                series={[{ name: 'Letos', values: window.GideonData.REVENUE.map(r => r.v), color: 'var(--c-signal)' },
                         { name: 'Loni', values: window.GideonData.REVENUE.map(r => r.prev), color: 'var(--text-3)', dashed: true }]} />
            </Cell>
            <Cell label="Plošný (area) · 1 série">
              <LineChart labels={window.GideonData.REVENUE.map(r => r.m)} unit=" tis." height={190}
                series={[{ name: 'Tržby', values: window.GideonData.REVENUE.map(r => r.v), color: 'var(--c-info)' }]} />
            </Cell>
            <Cell label="Sloupcový">
              <BarChart unit=" tis." data={window.GideonData.REVENUE.map(r => ({ label: r.m, value: r.v }))} />
            </Cell>
            <Cell label="Prstencový (donut)">
              <Donut data={window.GideonData.REVENUE_MIX} size={150} centerLabel="100" centerSub="% výnosů" />
            </Cell>
            <Cell label="Sparkline (v kartě)">
              <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', background: 'var(--surface)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Návštěvnost · 30 dní</div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', margin: '4px 0 8px' }}>4 600</div>
                <Sparkline values={window.GideonData.TRAFFIC} height={46} />
              </div>
            </Cell>
            <Cell label="Sparkline · klesající">
              <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', background: 'var(--surface)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Míra okamžitého opuštění</div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', margin: '4px 0 8px' }}>32 %</div>
                <Sparkline values={[...window.GideonData.TRAFFIC].reverse()} height={46} color="var(--c-ok)" />
              </div>
            </Cell>
          </div>
        </Sec>

        <Sec id="alerts" num="16" title="Alerty">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
            <Alert kind="info" title="Tip">Klienta lze založit i jako lead a doplnit údaje později.</Alert>
            <Alert kind="ok" title="Uloženo">Změny v nastavení byly úspěšně uloženy.</Alert>
            <Alert kind="warn" title="Pozor">Dvě faktury jsou po splatnosti.</Alert>
            <Alert kind="danger" title="Chyba">Klienta se nepodařilo smazat — má aktivní zakázku.</Alert>
          </div>
        </Sec>

        <Sec id="misc" num="17" title="Ostatní">
          <div className="kit-grid">
            <Cell label="Tooltip (najeď)"><Tooltip text="Smazat natrvalo"><button className="b b--outline b--icon"><GIc.trash /></button></Tooltip></Cell>
            <Cell label="File drop"><FileDrop hint="PDF, PNG · max 20 MB" /></Cell>
            <Cell label="Stránkování"><div className="pager"><button disabled>‹</button><button className="on">1</button><button>2</button><button>3</button><button>›</button></div></Cell>
            <Cell label="Breadcrumb"><div className="crumb"><span>Gideon</span><GIc.chevR /><span>Klienti</span><GIc.chevR /><b>Detail</b></div></Cell>
          </div>
        </Sec>

        <Sec id="colors" num="18" title="Barvy & tokeny">
          <div className="kit-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))' }}>
            {[['--ph-spark', 'Signal', '#fff'], ['--ph-explore', 'Teal', '#fff'], ['--ph-pause', 'Sand', '#181712'], ['--ph-launch', 'Green', '#fff'], ['--c-danger', 'Danger', '#fff'], ['--surface', 'Surface', 'var(--text)'], ['--bg', 'BG', 'var(--text)'], ['--line-2', 'Line', 'var(--text)']].map(([v, n, fg]) => (
              <div key={v}><div className="swatch-chip" style={{ background: 'var(' + v + ')' }}><span style={{ color: fg }}>{n}</span></div><div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>{v}</div></div>
            ))}
          </div>
        </Sec>
      </div>
    </div>
  );
}

Object.assign(window, { ComponentsPage, Checkbox, Radio, Slider, Stepper, Alert, Tooltip, MultiSelect });
