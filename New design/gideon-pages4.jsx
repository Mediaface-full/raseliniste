/* Gideon Admin · pages 4 — Audit log, Roles & permissions, Newsletter, Pages */
const { useState: p4UseState } = React;

/* ── AUDIT LOG ──────────────────────────────────────────── */
function AuditPage() {
  const D = window.GideonData;
  const [cat, setCat] = p4UseState('Vše');
  const [q, setQ] = p4UseState('');
  let rows = D.AUDIT.filter(a => (cat === 'Vše' || a.cat === cat) && (!q.trim() || (a.action + a.target + (D.G_USERS[a.who] || {}).name).toLowerCase().includes(q.toLowerCase().trim())));
  const catColor = { 'Klienti': 'var(--c-ok)', 'Projekty': 'var(--c-info)', 'Faktury': 'var(--c-signal)', 'Soubory': 'var(--c-violet)', 'Systém': 'var(--text-3)', 'Bezpečnost': 'var(--c-danger)' };

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Systém</div><h1>Audit log</h1><p>Kompletní historie změn — kdo, co a kdy. Neměnný záznam pro dohledatelnost.</p></div>
        <div className="actions"><button className="b b--outline"><GIc.upload />Export CSV</button></div>
      </div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 280 }}><GIc.search /><input placeholder="Hledat v záznamech…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{D.AUDIT_CATS.map(c => <button key={c} className={'fchip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}</div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Kdo</th><th>Akce</th><th>Detail</th><th>Kategorie</th><th>IP adresa</th><th>Čas</th></tr></thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td><div className="cell-main"><GAvatar who={a.who} size="sm" /><div className="nm2" style={{ fontSize: 13 }}>{(D.G_USERS[a.who] || {}).name}</div></div></td>
                <td><span className="mono" style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '2px 7px' }}>{a.action}</span></td>
                <td style={{ color: 'var(--text-2)', fontSize: 13 }}>{a.target}</td>
                <td><span className="st" style={{ color: catColor[a.cat], borderColor: `color-mix(in srgb, ${catColor[a.cat]} 40%, transparent)`, background: `color-mix(in srgb, ${catColor[a.cat]} 11%, transparent)` }}><span className="d" />{a.cat}</span></td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{a.ip}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{a.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot"><span>{rows.length} záznamů</span><span className="mono" style={{ fontSize: 12 }}>Uchováváme 90 dní</span></div>
      </div>
    </div>
  );
}

/* ── ROLES & PERMISSIONS ────────────────────────────────── */
function RolesPage() {
  const D = window.GideonData;
  const roleKeys = D.ROLES.map(r => r.key);
  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Systém</div><h1>Role &amp; oprávnění</h1><p>Co která role smí. Matici uprav podle potřeby týmu.</p></div>
        <div className="actions"><button className="b b--primary"><GIc.plus />Nová role</button></div>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        {D.ROLES.map(r => (
          <div className="role-card" key={r.key}>
            <div className="rc-top"><span className="rc-dot" style={{ background: r.c }} /><span className="rc-nm">{r.name}</span><span className="rc-ct">{r.count} {r.count === 1 ? 'člen' : 'členů'}</span></div>
            <div className="rc-desc">{r.desc}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head"><h3>Matice oprávnění</h3><span className="more mono">✓ = povoleno</span></div>
        <div className="panel__body" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="perm">
            <thead>
              <tr><th style={{ minWidth: 220 }}>Oprávnění</th>{D.ROLES.map(r => <th key={r.key}>{r.name}<div className="rl2">{r.count} čl.</div></th>)}</tr>
            </thead>
            <tbody>
              {D.PERM_GROUPS.map((g, gi) => (
                <React.Fragment key={gi}>
                  <tr className="grp"><td colSpan={roleKeys.length + 1}>{g.group}</td></tr>
                  {g.perms.map((p, pi) => (
                    <tr key={pi}>
                      <td className="lbl3">{p.label}</td>
                      {roleKeys.map(rk => <td key={rk}>{p.m[rk] ? <span className="yes"><GIc.check /></span> : <span className="no">—</span>}</td>)}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── NEWSLETTER ─────────────────────────────────────────── */
function NewsletterPage() {
  const D = window.GideonData;
  const S = D.SUBSCRIBERS;
  const statusLabel = { sent: 'Odesláno', draft: 'Koncept', scheduled: 'Naplánováno' };
  const statusCls = { sent: 'paid', draft: 'draft', scheduled: 'sent' };

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Obsah</div><h1>Newsletter</h1><p>Rozesílky a odběratelé. {S.active} aktivních kontaktů.</p></div>
        <div className="actions"><button className="b b--outline"><GIc.users />Odběratelé</button><button className="b b--primary"><GIc.plus />Nová kampaň</button></div>
      </div>

      <div className="stats">
        <div className="stat"><div className="top"><span className="lbl">Odběratelé</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-info) 14%, transparent)', color: 'var(--c-info)' }}><GIc.users /></span></div><div className="val">{S.total}</div><div className="delta up"><GIc.arrowUp style={{ width: 13, height: 13 }} />{S.growth}<span className="vs">tento měsíc</span></div></div>
        <div className="stat"><div className="top"><span className="lbl">Aktivní</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-ok) 14%, transparent)', color: 'var(--c-ok)' }}><GIc.check /></span></div><div className="val">{S.active}</div><div className="delta"><span className="vs">{Math.round(S.active / S.total * 100)} % z celku</span></div></div>
        <div className="stat"><div className="top"><span className="lbl">Prům. open rate</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-signal) 14%, transparent)', color: 'var(--c-signal)' }}><GIc.mail /></span></div><div className="val">38,2 %</div><div className="delta up"><GIc.arrowUp style={{ width: 13, height: 13 }} />+2,4 b.<span className="vs">vs. obor</span></div></div>
        <div className="stat"><div className="top"><span className="lbl">Odhlášení</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-danger) 14%, transparent)', color: 'var(--c-danger)' }}><GIc.logout /></span></div><div className="val">{S.unsub}</div><div className="delta"><span className="vs">za 30 dní</span></div></div>
      </div>

      <div className="panel">
        <div className="panel__head"><h3>Kampaně</h3></div>
        <div className="panel__body">
          <table className="tbl">
            <thead><tr><th>Předmět</th><th>Stav</th><th>Odesláno</th><th className="r">Příjemci</th><th className="r">Open</th><th className="r">Click</th><th style={{ width: 60 }}></th></tr></thead>
            <tbody>
              {D.CAMPAIGNS.map(c => (
                <tr key={c.id}>
                  <td><div className="nm2" style={{ fontWeight: 600 }}>{c.subject}</div></td>
                  <td><StatusBadge status={statusCls[c.status]} label={statusLabel[c.status]} /></td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(c.sent)}</td>
                  <td className="r mono" style={{ fontSize: 13 }}>{c.recipients ? c.recipients : '—'}</td>
                  <td className="r">{c.open ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}><div style={{ width: 46, height: 6, borderRadius: 3, background: 'var(--surface-3)' }}><div style={{ width: c.open + '%', height: '100%', borderRadius: 3, background: 'var(--c-signal)' }} /></div><span className="mono" style={{ fontSize: 12 }}>{c.open} %</span></span> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                  <td className="r mono" style={{ fontSize: 13, color: c.click ? 'var(--text)' : 'var(--text-3)' }}>{c.click ? c.click + ' %' : '—'}</td>
                  <td><div className="rowact"><button title="Detail"><GIc.ext /></button><button title="Více"><GIc.more /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── PAGES (web CMS) ────────────────────────────────────── */
function PagesPage() {
  const D = window.GideonData;
  const _b = window.BRAND || {};
  const [q, setQ] = p4UseState('');
  const [status, setStatus] = p4UseState('all');
  const filters = [{ value: 'all', label: 'Vše' }, { value: 'published', label: 'Publikováno' }, { value: 'draft', label: 'Koncepty' }, { value: 'scheduled', label: 'Naplánováno' }];
  let rows = D.WEB_PAGES.filter(p => (status === 'all' || p.status === status) && (!q.trim() || (p.title + p.path).toLowerCase().includes(q.toLowerCase().trim())));
  const statusLabel = { published: 'Publikováno', draft: 'Koncept', scheduled: 'Naplánováno' };
  const statusCls = { published: 'active', draft: 'draft', scheduled: 'sent' };
  const totalViews = D.WEB_PAGES.reduce((s, p) => s + p.views, 0);

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Obsah</div><h1>Stránky</h1><p>Obsah webu {_b.web || 'gide-on.cz'} — {D.WEB_PAGES.length} stránek, {totalViews.toLocaleString('cs-CZ')} zobrazení/měsíc.</p></div>
        <div className="actions"><button className="b b--outline"><GIc.ext />Otevřít web</button><button className="b b--primary"><GIc.plus />Nová stránka</button></div>
      </div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 280 }}><GIc.search /><input placeholder="Hledat stránku…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>{filters.map(s => <button key={s.value} className={'fchip' + (status === s.value ? ' on' : '')} onClick={() => setStatus(s.value)}>{s.label}</button>)}</div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Stránka</th><th>URL</th><th>Stav</th><th className="r">Zobrazení / měsíc</th><th>Upravil</th><th>Aktualizováno</th><th style={{ width: 90 }}></th></tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td><div className="cell-main"><span className="ic" style={{ width: 32, height: 32, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--text-3)', flex: 'none' }}><GIc.doc style={{ width: 16, height: 16 }} /></span><div className="nm2">{p.title}</div></div></td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.path}</td>
                <td><StatusBadge status={statusCls[p.status]} label={statusLabel[p.status]} /></td>
                <td className="r mono" style={{ fontSize: 13 }}>{p.views ? p.views.toLocaleString('cs-CZ') : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                <td><GAvatar who={p.by} size="sm" /></td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(p.updated)}</td>
                <td><div className="rowact"><button title="Upravit"><GIc.edit /></button><button title="Náhled"><GIc.ext /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot"><span>{rows.length} z {D.WEB_PAGES.length} stránek</span></div>
      </div>
    </div>
  );
}

Object.assign(window, { AuditPage, RolesPage, NewsletterPage, PagesPage });
