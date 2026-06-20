/* Gideon Admin · pages 3 — Analytics, Notifications, Inbox, Calendar, Files */
const { useState: p3UseState, useMemo: p3UseMemo } = React;

/* extra icons used across modules 3 & 4 */
const XIc = {
  star:   (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="m12 2 2.9 6.3 6.8.7-5.1 4.6 1.4 6.7L12 17.5 6 20.6l1.4-6.7L2.3 9l6.8-.7z"/></svg>,
  starO:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...p}><path d="m12 3.2 2.6 5.7 6.2.6-4.7 4.2 1.3 6.1L12 16.9l-5.7 2.9 1.3-6.1L3 9.5l6.2-.6z"/></svg>,
  reply:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v1"/></svg>,
  download:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>,
  filter: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>,
  history:(p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2"/></svg>,
  send:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>,
};

/* ── ANALYTICS / REPORTS ────────────────────────────────── */
function AnalyticsPage() {
  const D = window.GideonData;
  const [period, setPeriod] = p3UseState('6m');
  const periods = [{ value: '30d', label: '30 dní' }, { value: '3m', label: '3 měsíce' }, { value: '6m', label: '6 měsíců' }, { value: '12m', label: 'Rok' }];
  const totalRev = D.REVENUE.reduce((s, r) => s + r.v, 0);
  const funnelMax = Math.max(...D.FUNNEL.map(f => f.value));
  const heatMax = Math.max(...D.HEATMAP.flatMap(r => r.cells));

  const kpis = [
    { lbl: 'Tržby celkem', val: totalRev + ' tis.', delta: '+8,4 %', up: true, c: 'var(--c-signal)' },
    { lbl: 'Konverze poptávek', val: '8,0 %', delta: '+1,2 b.', up: true, c: 'var(--c-ok)' },
    { lbl: 'Prům. hodnota zakázky', val: '74,2 tis.', delta: '−3,1 %', up: false, c: 'var(--c-info)' },
    { lbl: 'Návštěvnost / měsíc', val: '4 600', delta: '+18 %', up: true, c: 'var(--c-violet)' },
  ];

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Přehled</div><h1>Analytika</h1><p>Tržby, akvizice a provoz napříč agenturou. Vyber období a porovnej s předchozím.</p></div>
        <div className="actions"><button className="b b--outline"><GIc.upload />Export reportu</button></div>
      </div>

      <div className="filterbar">
        <SegRadio value={period} onChange={setPeriod} options={periods} />
        <span className="spacer" />
        <button className="b b--ghost b--sm"><XIc.filter />Filtry</button>
      </div>

      <div className="stats">
        {kpis.map((s, i) => (
          <div className="stat" key={i}>
            <div className="top"><span className="lbl">{s.lbl}</span><span className="ic" style={{ background: `color-mix(in srgb, ${s.c} 14%, transparent)`, color: s.c }}><GIc.spark /></span></div>
            <div className="val">{s.val}</div>
            <div className={'delta ' + (s.up ? 'up' : 'down')}>{s.up ? <GIc.arrowUp style={{ width: 13, height: 13 }} /> : <GIc.arrowDn style={{ width: 13, height: 13 }} />}{s.delta}<span className="vs">vs. min. období</span></div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel__head"><h3>Tržby v čase</h3>
            <div className="chart-legend"><span className="lg"><span className="sw" style={{ background: 'var(--c-signal)' }} />Letos</span><span className="lg" style={{ color: 'var(--text-3)' }}><span className="sw dash" />Loni</span><span className="more mono">tis. Kč</span></div>
          </div>
          <div className="panel__body pad">
            <LineChart labels={D.REVENUE.map(r => r.m)} unit=" tis." height={220}
              series={[{ name: 'Letos', values: D.REVENUE.map(r => r.v), color: 'var(--c-signal)', area: true }, { name: 'Loni', values: D.REVENUE.map(r => r.prev), color: 'var(--text-3)', dashed: true }]} />
          </div>
        </div>
        <div className="panel">
          <div className="panel__head"><h3>Skladba výnosů</h3><span className="more mono">podíl</span></div>
          <div className="panel__body pad"><Donut data={D.REVENUE_MIX} centerLabel="100" centerSub="% výnosů" /></div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__head"><h3>Akviziční trychtýř</h3><span className="more mono">poptávka → podpis</span></div>
          <div className="panel__body pad">
            <div className="funnel">
              {D.FUNNEL.map((f, i) => (
                <div className="step" key={i}>
                  <div className="bar" style={{ width: (f.value / funnelMax * 100) + '%', background: f.c }}>{f.value.toLocaleString('cs-CZ')}</div>
                  <div className="meta"><div className="lb">{f.label}</div><div className="pc">{Math.round(f.value / funnelMax * 100)} %{i > 0 && <> · {Math.round(f.value / D.FUNNEL[i - 1].value * 100)} % krok</>}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head"><h3>Projekty podle typu</h3><span className="more mono">letos</span></div>
          <div className="panel__body pad"><BarChart data={D.PROJECTS_BY_TYPE} unit=" ks" /></div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__head"><h3>Zdroje návštěvnosti</h3><span className="more mono">% relací</span></div>
          <div className="panel__body pad">
            <div className="hbars">
              {D.SOURCES.map((s, i) => (
                <div className="hbar" key={i}>
                  <div className="top"><span className="nm">{s.label}</span><span className="vv">{s.value} %</span></div>
                  <div className="track"><i style={{ width: s.value + '%', background: s.c }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head"><h3>Heatmapa aktivity</h3><span className="more mono">8:00–20:00</span></div>
          <div className="panel__body pad">
            <div className="heat">
              {D.HEATMAP.map((row, ri) => (
                <React.Fragment key={ri}>
                  <span className="hd">{row.day}</span>
                  <div className="hrow">
                    {row.cells.map((v, ci) => (
                      <div className="cell" key={ci} title={v + ' událostí'} style={{ background: v === 0 ? 'var(--surface-3)' : `color-mix(in srgb, var(--c-signal) ${Math.round(v / heatMax * 100)}%, var(--surface-3))` }} />
                    ))}
                  </div>
                </React.Fragment>
              ))}
            </div>
            <div className="scale"><span>méně</span><i style={{ background: 'var(--surface-3)' }} /><i style={{ background: 'color-mix(in srgb, var(--c-signal) 35%, var(--surface-3))' }} /><i style={{ background: 'color-mix(in srgb, var(--c-signal) 70%, var(--surface-3))' }} /><i style={{ background: 'var(--c-signal)' }} /><span>více</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── NOTIFICATIONS + INBOX ──────────────────────────────── */
function NotificationsPage() {
  const D = window.GideonData;
  const [tab, setTab] = p3UseState('notif');
  const [notifs, setNotifs] = p3UseState(D.NOTIFS);
  const [filter, setFilter] = p3UseState('all');
  const unread = notifs.filter(n => !n.read).length;

  const NIC = { invoice: { i: GIc.invoice, c: 'var(--c-signal)' }, danger: { i: GIc.invoice, c: 'var(--c-danger)' }, project: { i: GIc.folder, c: 'var(--c-info)' }, client: { i: GIc.users, c: 'var(--c-ok)' }, mention: { i: GIc.mail, c: 'var(--c-violet)' }, system: { i: GIc.cog, c: 'var(--text-3)' } };
  let rows = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Přehled</div><h1>Oznámení &amp; zprávy</h1><p>Centrum upozornění a klientská schránka na jednom místě.</p></div>
        <div className="actions"><button className="b b--outline" onClick={() => setNotifs(ns => ns.map(n => ({ ...n, read: true })))}><GIc.check />Označit vše jako přečtené</button></div>
      </div>

      <Tabs tabs={[{ key: 'notif', label: 'Oznámení', count: unread }, { key: 'inbox', label: 'Schránka', count: D.THREADS.filter(t => t.unread).length }]} active={tab} onChange={setTab} />

      {tab === 'notif' && (
        <>
          <div className="filterbar"><SegRadio value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Vše' }, { value: 'unread', label: 'Nepřečtené' }]} /></div>
          <div className="panel">
            <div className="notif-list">
              {rows.map(n => {
                const ic = NIC[n.kind] || NIC.system;
                return (
                  <div className={'notif' + (n.read ? '' : ' unread')} key={n.id} onClick={() => setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, read: true } : x))}>
                    <span className="nic" style={{ background: `color-mix(in srgb, ${ic.c} 14%, transparent)`, color: ic.c }}><ic.i /></span>
                    <div><div className="ttl2">{n.title}</div><div className="tx2" dangerouslySetInnerHTML={{ __html: n.text }} /></div>
                    <time>{n.at}</time>
                  </div>
                );
              })}
              {rows.length === 0 && <div className="empty"><div className="big">Žádná nepřečtená</div><div className="sm">Jsi v obraze.</div></div>}
            </div>
          </div>
        </>
      )}

      {tab === 'inbox' && (
        <div className="panel">
          <div className="inbox">
            {D.THREADS.map(t => (
              <div className={'thread' + (t.unread ? ' unread' : '')} key={t.id}>
                <span className={'star' + (t.starred ? ' on' : '')}>{t.starred ? <XIc.star /> : <XIc.starO />}</span>
                <GAvatar who={t.who} size="sm" />
                <div className="body2">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span className="from">{t.from}</span></div>
                  <div className="subj">{t.subject}</div>
                  <div className="prev">{t.preview}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <time>{t.at}</time>
                  <span className="rowact" style={{ opacity: 1 }}><button title="Odpovědět" style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--text-3)' }}><XIc.reply /></button></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── CALENDAR ───────────────────────────────────────────── */
function CalendarPage() {
  const D = window.GideonData;
  /* fixed month: červen 2026 (1.6.2026 = neděle → first weekday Mon-based) */
  const year = 2026, month = 5; // June (0-indexed)
  const monthName = 'Červen 2026';
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = 18;
  const evByDay = {};
  D.CAL_EVENTS.forEach(e => { const d = +e.date.slice(8, 10); (evByDay[d] = evByDay[d] || []).push(e); });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ out: true, n: prevDays - firstDow + 1 + i });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ n: d });
  while (cells.length % 7 !== 0) cells.push({ out: true, n: cells.length - daysInMonth - firstDow + 1 });

  const upcoming = D.CAL_EVENTS.filter(e => +e.date.slice(8, 10) >= today).slice(0, 6);
  const kindLabel = { meeting: 'Schůzka', deadline: 'Termín', invoice: 'Faktura', review: 'Review' };

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Přehled</div><h1>Kalendář</h1><p>Schůzky, termíny projektů a splatnosti faktur na jednom plátně.</p></div>
        <div className="actions"><button className="b b--primary"><GIc.plus />Nová událost</button></div>
      </div>

      <div className="grid-12">
        <div className="cal">
          <div className="cal__head">
            <h3>{monthName}</h3>
            <div className="cal__nav"><button className="b b--outline b--icon"><GIc.chevron style={{ transform: 'rotate(90deg)' }} /></button><button className="b b--outline b--sm">Dnes</button><button className="b b--outline b--icon"><GIc.chevron style={{ transform: 'rotate(-90deg)' }} /></button></div>
          </div>
          <div className="cal__dow">{['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => <span key={d}>{d}</span>)}</div>
          <div className="cal__grid">
            {cells.map((c, i) => (
              <div className={'cal__cell' + (c.out ? ' out' : '') + (!c.out && c.n === today ? ' today' : '')} key={i}>
                <span className="dn">{c.n}</span>
                {!c.out && (evByDay[c.n] || []).map((e, j) => <span className={'cal-ev ' + e.kind} key={j} title={e.title}>{e.title}</span>)}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel__head"><h3>Nadcházející</h3></div>
          <div className="panel__body pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {upcoming.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 'none', width: 44, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{+e.date.slice(8, 10)}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>čvn</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingLeft: 12, borderLeft: '2.5px solid', borderColor: { meeting: 'var(--c-info)', deadline: 'var(--c-danger)', invoice: 'var(--c-signal)', review: 'var(--c-warn)' }[e.kind] }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{kindLabel[e.kind]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── FILE MANAGER ───────────────────────────────────────── */
function FilesPage() {
  const D = window.GideonData;
  const [view, setView] = p3UseState('grid');
  const [q, setQ] = p3UseState('');
  const [kind, setKind] = p3UseState('all');
  const kinds = [{ value: 'all', label: 'Vše' }, { value: 'pdf', label: 'PDF' }, { value: 'img', label: 'Obrázky' }, { value: 'docx', label: 'Dokumenty' }, { value: 'zip', label: 'Archivy' }];
  let rows = D.FILES.filter(f => (kind === 'all' || f.kind === kind || (kind === 'docx' && ['docx', 'xlsx', 'csv'].includes(f.kind))) && (!q.trim() || (f.name + f.client).toLowerCase().includes(q.toLowerCase().trim())));
  const col = k => D.FILE_KIND_COLOR[k] || D.FILE_KIND_COLOR.other;

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Obsah</div><h1>Soubory</h1><p>Smlouvy, podklady a exporty napříč klienty. {D.FILES.length} souborů.</p></div>
        <div className="actions"><button className="b b--primary"><GIc.upload />Nahrát</button></div>
      </div>

      <div style={{ marginBottom: 18 }}><FileDrop hint="Přetáhni sem soubory · PDF, obrázky, archivy · max 20 MB" /></div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 280 }}><GIc.search /><input placeholder="Hledat soubor…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>{kinds.map(k => <button key={k.value} className={'fchip' + (kind === k.value ? ' on' : '')} onClick={() => setKind(k.value)}>{k.label}</button>)}</div>
        <span className="spacer" />
        <SegRadio value={view} onChange={setView} options={[{ value: 'grid', label: 'Mřížka' }, { value: 'list', label: 'Seznam' }]} />
      </div>

      {view === 'grid' ? (
        <div className="file-grid">
          {rows.map(f => (
            <div className="fcard" key={f.id}>
              <div className="thumb" style={{ background: `color-mix(in srgb, ${col(f.kind)} 12%, var(--surface))` }}>
                <span className="ext" style={{ background: col(f.kind) }}>{f.kind === 'img' ? 'IMG' : f.kind === 'video' ? 'MP4' : f.kind.toUpperCase()}</span>
              </div>
              <div className="meta2">
                <div className="nm3" title={f.name}>{f.name}</div>
                <div className="sub3"><span>{f.size}</span><span>{f.client !== '—' ? f.client : 'obecné'}</span></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Soubor</th><th>Klient</th><th>Velikost</th><th>Nahrál</th><th>Datum</th><th style={{ width: 60 }}></th></tr></thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.id}>
                  <td><div className="cell-main"><span className="ic" style={{ width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: col(f.kind), color: '#fff', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, fontWeight: 700, flex: 'none' }}>{f.kind.toUpperCase().slice(0, 3)}</span><div className="nm2">{f.name}</div></div></td>
                  <td style={{ color: 'var(--text-2)' }}>{f.client}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{f.size}</td>
                  <td><GAvatar who={f.by} size="sm" /></td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(f.at)}</td>
                  <td><div className="rowact"><button title="Stáhnout"><XIc.download /></button><button title="Více"><GIc.more /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tbl-foot"><span>{rows.length} souborů</span></div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AnalyticsPage, NotificationsPage, CalendarPage, FilesPage, XIc });
