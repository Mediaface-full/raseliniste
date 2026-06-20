/* Gideon Admin · pages */
const { useState: pUseState, useMemo: pUseMemo } = React;

/* ── DASHBOARD ──────────────────────────────────────────── */
function Dashboard({ onNav }) {
  const { CLIENTS, INVOICES, PROJECTS, ACTIVITY, REVENUE, REVENUE_MIX, TRAFFIC, G_USERS } = window.GideonData;
  const activeClients = CLIENTS.filter(c => c.status === 'active').length;
  const mrr = CLIENTS.reduce((s, c) => s + c.mrr, 0);
  const overdue = INVOICES.filter(i => i.status === 'overdue');
  const overdueSum = overdue.reduce((s, i) => s + i.amount, 0);
  const openProjects = PROJECTS.filter(p => ['active', 'review'].includes(p.status)).length;
  const maxRev = Math.max(...REVENUE.map(r => r.v));

  const stats = [
    { lbl: 'Aktivní klienti', val: activeClients, delta: '+2', up: true, ic: <GIc.users />, c: 'var(--c-info)' },
    { lbl: 'Měsíční tržby (MRR)', val: money(mrr), delta: '+8,4 %', up: true, ic: <GIc.spark />, c: 'var(--c-signal)' },
    { lbl: 'Otevřené projekty', val: openProjects, delta: '+1', up: true, ic: <GIc.folder />, c: 'var(--c-ok)' },
    { lbl: 'Po splatnosti', val: money(overdueSum), delta: overdue.length + ' faktury', up: false, ic: <GIc.invoice />, c: 'var(--c-danger)' },
  ];

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Přehled</div>
          <h1>Dobré ráno, Jane.</h1>
          <p>Tady je stav agentury k dnešnímu dni. Dvě faktury jsou po splatnosti — připomenout?</p>
        </div>
        <div className="actions">
          <button className="b b--outline" onClick={() => onNav('invoices')}><GIc.invoice />Faktury</button>
          <button className="b b--primary" onClick={() => onNav('client-new')}><GIc.plus />Nový klient</button>
        </div>
      </div>

      <div className="stats">
        {stats.map((s, i) => (
          <div className="stat" key={i}>
            <div className="top">
              <span className="lbl">{s.lbl}</span>
              <span className="ic" style={{ background: `color-mix(in srgb, ${s.c} 14%, transparent)`, color: s.c }}>{s.ic}</span>
            </div>
            <div className="val">{s.val}</div>
            <div className={'delta ' + (s.up ? 'up' : 'down')}>
              {s.up ? <GIc.arrowUp style={{ width: 13, height: 13 }} /> : <GIc.arrowDn style={{ width: 13, height: 13 }} />}
              {s.delta}<span className="vs">{s.up ? 'vs. minulý měsíc' : 'k řešení'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel__head"><h3>Poslední faktury</h3><a className="more" onClick={() => onNav('invoices')}>Vše<GIc.chevR /></a></div>
          <div className="panel__body">
            <table className="tbl">
              <tbody>
                {INVOICES.slice(0, 5).map(inv => (
                  <tr key={inv.id} onClick={() => onNav('invoices')}>
                    <td><div className="cell-main"><span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{inv.id}</span></div></td>
                    <td style={{ color: 'var(--text-2)' }}>{inv.client}</td>
                    <td className="r money">{money(inv.amount)}</td>
                    <td className="r"><StatusBadge status={inv.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h3>Tržby · 6 měsíců</h3>
            <div className="chart-legend">
              <span className="lg"><span className="sw" style={{ background: 'var(--c-signal)' }} />Letos</span>
              <span className="lg" style={{ color: 'var(--text-3)' }}><span className="sw dash" />Loni</span>
              <span className="more mono">tis. Kč</span>
            </div>
          </div>
          <div className="panel__body pad">
            <LineChart
              labels={REVENUE.map(r => r.m)}
              unit=" tis."
              series={[
                { name: 'Letos', values: REVENUE.map(r => r.v), color: 'var(--c-signal)', area: true },
                { name: 'Loni', values: REVENUE.map(r => r.prev), color: 'var(--text-3)', dashed: true },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__head"><h3>Skladba výnosů</h3><span className="more mono">podíl</span></div>
          <div className="panel__body pad">
            <Donut data={REVENUE_MIX} centerLabel={money(mrr).replace(' Kč', '')} centerSub="MRR Kč" />
          </div>
        </div>
        <div className="panel">
          <div className="panel__head"><h3>Návštěvnost webu</h3><span className="more mono">30 dní</span></div>
          <div className="panel__body pad">
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em' }}>{TRAFFIC[TRAFFIC.length - 1]}00</div>
                <div className="delta up" style={{ marginTop: 4 }}><GIc.arrowUp style={{ width: 13, height: 13 }} />+18 %<span className="vs">vs. minulý měsíc</span></div>
              </div>
              <div style={{ flex: 1, maxWidth: 320 }}><Sparkline values={TRAFFIC} height={64} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__head"><h3>Aktivní projekty</h3><a className="more" onClick={() => onNav('projects')}>Vše<GIc.chevR /></a></div>
          <div className="panel__body">
            <table className="tbl">
              <tbody>
                {PROJECTS.filter(p => ['active', 'review'].includes(p.status)).slice(0, 4).map(p => (
                  <tr key={p.id} onClick={() => onNav('projects')}>
                    <td><div className="cell-main"><div><div className="nm2">{p.name}</div><div className="sub2">{p.client}</div></div></div></td>
                    <td style={{ width: 150 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface-3)' }}>
                          <div style={{ width: p.progress + '%', height: '100%', borderRadius: 3, background: 'var(--c-signal)' }} />
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.progress}%</span>
                      </div>
                    </td>
                    <td className="r"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head"><h3>Aktivita týmu</h3></div>
          <div className="panel__body">
            <div className="feed">
              {ACTIVITY.map((a, i) => (
                <div className="it" key={i}>
                  <GAvatar who={a.who} size="sm" />
                  <span className="tx" dangerouslySetInnerHTML={{ __html: a.text }} />
                  <time>{a.at}</time>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── TABLE TOOLBAR (shared) ─────────────────────────────── */
function TableToolbar({ q, setQ, filters, children }) {
  return (
    <div className="toolbar">
      <div className="search"><GIc.search /><input placeholder="Hledat…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {filters}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>{children}</div>
    </div>
  );
}

/* ── CLIENTS ────────────────────────────────────────────── */
function ClientsPage({ onOpen, onNew }) {
  const { CLIENTS } = window.GideonData;
  const [q, setQ] = pUseState('');
  const [status, setStatus] = pUseState('all');
  const [sort, setSort] = pUseState({ k: 'name', d: 1 });
  const [sel, setSel] = pUseState([]);

  const statuses = [{ value: 'all', label: 'Všichni' }, { value: 'active', label: 'Aktivní' }, { value: 'lead', label: 'Leads' }, { value: 'paused', label: 'Pozastavení' }];

  let rows = CLIENTS.filter(c => (status === 'all' || c.status === status) &&
    (!q.trim() || (c.name + c.contact + c.city + c.email).toLowerCase().includes(q.toLowerCase().trim())));
  rows = [...rows].sort((a, b) => {
    let av = a[sort.k], bv = b[sort.k];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.d;
  });
  const sk = (k) => setSort(s => s.k === k ? { k, d: -s.d } : { k, d: 1 });
  const Ar = ({ k }) => <span className="ar">{sort.k === k ? (sort.d === 1 ? '↑' : '↓') : '↕'}</span>;
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const allOn = rows.length > 0 && sel.length === rows.length;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Správa</div>
          <h1>Klienti</h1>
          <p>Evidence klientů, leadů a jejich plánů. Klikni na řádek pro detail a specifikace.</p>
        </div>
        <div className="actions">
          <button className="b b--outline"><GIc.upload />Export</button>
          <button className="b b--primary" onClick={onNew}><GIc.plus />Nový klient</button>
        </div>
      </div>

      <TableToolbar q={q} setQ={setQ}
        filters={<div style={{ display: 'flex', gap: 8 }}>{statuses.map(s => (
          <button key={s.value} className={'fchip' + (status === s.value ? ' on' : '')} onClick={() => setStatus(s.value)}>{s.label}</button>
        ))}</div>} />

      {sel.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 11, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{sel.length} vybráno</span>
          <button className="b b--ghost b--sm"><GIc.mail />Hromadný e-mail</button>
          <button className="b b--ghost b--sm" style={{ color: 'var(--c-danger)' }}><GIc.trash />Archivovat</button>
          <button className="b b--ghost b--sm" style={{ marginLeft: 'auto' }} onClick={() => setSel([])}>Zrušit výběr</button>
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}><span className={'check' + (allOn ? ' on' : '')} onClick={() => setSel(allOn ? [] : rows.map(r => r.id))}>{allOn && <GIc.check />}</span></th>
              <th onClick={() => sk('name')}>Klient <Ar k="name" /></th>
              <th onClick={() => sk('city')}>Město <Ar k="city" /></th>
              <th onClick={() => sk('status')}>Stav <Ar k="status" /></th>
              <th onClick={() => sk('plan')}>Plán <Ar k="plan" /></th>
              <th className="r" onClick={() => sk('mrr')}>MRR <Ar k="mrr" /></th>
              <th onClick={() => sk('projects')}>Projekty <Ar k="projects" /></th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td onClick={e => { e.stopPropagation(); toggle(c.id); }}><span className={'check' + (sel.includes(c.id) ? ' on' : '')}>{sel.includes(c.id) && <GIc.check />}</span></td>
                <td>
                  <div className="cell-main">
                    <GAvatar who={c.name.slice(0, 2)} size="sm" />
                    <div><div className="nm2">{c.name}</div><div className="sub2">{c.contact} · IČO {c.ico}</div></div>
                  </div>
                </td>
                <td style={{ color: 'var(--text-2)' }}>{c.city}</td>
                <td><StatusBadge status={c.status} /></td>
                <td><span className="mono" style={{ fontSize: 12, color: c.plan === '—' ? 'var(--text-3)' : 'var(--text)' }}>{c.plan}</span></td>
                <td className="r money">{c.mrr ? money(c.mrr) : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td><span className="mono" style={{ fontSize: 13 }}>{c.projects}</span></td>
                <td>
                  <div className="rowact">
                    <button onClick={e => { e.stopPropagation(); onOpen(c.id); }} title="Detail"><GIc.ext /></button>
                    <button onClick={e => e.stopPropagation()} title="Více"><GIc.more /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot">
          <span>{rows.length} z {CLIENTS.length} klientů</span>
          <div className="pager">
            <button disabled>‹</button><button className="on">1</button><button>2</button><button>›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CLIENT DETAIL (specifications) ─────────────────────── */
function ClientDetail({ client, onBack, onEdit }) {
  const { PROJECTS, INVOICES, G_USERS } = window.GideonData;
  const [tab, setTab] = pUseState('overview');
  const projs = PROJECTS.filter(p => p.clientId === client.id);
  const invs = INVOICES.filter(i => i.clientId === client.id);
  const owner = G_USERS[client.owner];

  const tabs = [
    { key: 'overview', label: 'Přehled' },
    { key: 'projects', label: 'Projekty', count: projs.length },
    { key: 'invoices', label: 'Faktury', count: invs.length },
    { key: 'files', label: 'Soubory', count: 4 },
  ];

  return (
    <div className="page">
      <div className="crumb" style={{ marginBottom: 18, cursor: 'pointer' }} onClick={onBack}>
        <GIc.chevron style={{ transform: 'rotate(90deg)' }} /><span>Klienti</span>
        <GIc.chevR /><b>{client.name}</b>
      </div>

      <div className="dethead">
        <span className="av-lg" style={{ background: 'color-mix(in srgb, var(--ph-spark) 20%, var(--surface))', color: 'var(--c-ink)', boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--ph-spark) 55%, transparent)' }}>{client.name.slice(0, 2).toUpperCase()}</span>
        <div className="meta">
          <h1>{client.name}<StatusBadge status={client.status} /></h1>
          <div className="sub">
            <span><GIc.pin />{client.city}</span>
            <span><GIc.mail />{client.email}</span>
            <span><GIc.phone />{client.phone}</span>
          </div>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 10 }}>
          <button className="b b--outline"><GIc.mail />Napsat</button>
          <button className="b b--primary" onClick={onEdit}><GIc.edit />Upravit</button>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid-2">
          <div className="panel">
            <div className="panel__head"><h3>Specifikace</h3></div>
            <div className="panel__body pad">
              <div className="spec">
                <div className="row"><span className="k">IČO</span><span className="v mono">{client.ico}</span></div>
                <div className="row"><span className="k">Kontaktní osoba</span><span className="v">{client.contact}</span></div>
                <div className="row"><span className="k">Plán</span><span className="v">{client.plan}</span></div>
                <div className="row"><span className="k">Měsíční paušál</span><span className="v mono">{client.mrr ? money(client.mrr) : '—'}</span></div>
                <div className="row"><span className="k">Klientem od</span><span className="v mono">{gFmtDate(client.since)}</span></div>
                <div className="row"><span className="k">Garant</span><span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><GAvatar who={client.owner} size="sm" />{owner.name}</span></div>
                <div className="row"><span className="k">Město</span><span className="v">{client.city}</span></div>
                <div className="row"><span className="k">Faktury po splatnosti</span><span className="v mono" style={{ color: client.invoicesDue ? 'var(--c-danger)' : 'var(--text)' }}>{client.invoicesDue}</span></div>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel__head"><h3>Poznámka</h3></div>
            <div className="panel__body pad">
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>{client.note}</p>
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div className="spec" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="row"><span className="k">Otevřené projekty</span><span className="v mono">{projs.filter(p => p.status !== 'done').length}</span></div>
                  <div className="row"><span className="k">Fakturováno celkem</span><span className="v mono">{money(invs.reduce((s, i) => s + i.amount, 0))}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Projekt</th><th>Typ</th><th>Postup</th><th>Termín</th><th className="r">Rozpočet</th><th>Stav</th></tr></thead>
            <tbody>
              {projs.map(p => (
                <tr key={p.id}>
                  <td><div className="nm2" style={{ fontWeight: 600 }}>{p.name}</div></td>
                  <td style={{ color: 'var(--text-2)' }}>{p.type}</td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{p.progress}%</span></td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(p.deadline)}</td>
                  <td className="r money">{p.budget ? money(p.budget) : '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
              {projs.length === 0 && <tr><td colSpan="6"><div className="empty"><div className="big">Žádné projekty</div><div className="sm">U tohoto klienta zatím nic neběží.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Číslo</th><th>Vystaveno</th><th>Splatnost</th><th className="r">Částka</th><th>Stav</th></tr></thead>
            <tbody>
              {invs.map(i => (
                <tr key={i.id}>
                  <td><span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{i.id}</span></td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(i.issued)}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(i.due)}</td>
                  <td className="r money">{money(i.amount)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
              {invs.length === 0 && <tr><td colSpan="5"><div className="empty"><div className="big">Žádné faktury</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'files' && (
        <div className="panel"><div className="panel__body pad">
          <FileDrop hint="Smlouvy, podklady, exporty · max 20 MB" />
          <div style={{ marginTop: 16 }}>
            {[['smlouva-2024.pdf', 'pdf', '240 kB'], ['logo-podklady.zip', 'other', '4,1 MB'], ['brief-web.docx', 'docx', '56 kB'], ['ceník-služeb.xlsx', 'xlsx', '31 kB']].map(([n, k, s]) => (
              <div className="file" key={n}>
                <span className="ic" style={{ background: window.HatchData ? (window.HatchData.FILE_COLORS[k] || 'var(--ph-archive)') : 'var(--ph-archive)' }}>{k.toUpperCase()}</span>
                <div className="meta"><div className="nm">{n}</div><div className="sz">{s}</div></div>
                <span className="arr"><GIc.ext style={{ width: 15, height: 15 }} /></span>
              </div>
            ))}
          </div>
        </div></div>
      )}
    </div>
  );
}

window.GideonPages1 = { Dashboard, ClientsPage, ClientDetail, TableToolbar };
Object.assign(window, { Dashboard, ClientsPage, ClientDetail, TableToolbar });
