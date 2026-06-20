/* Gideon Admin · pages part 2 — projects, invoices, users, settings, client form */
const { useState: p2UseState } = React;

/* ── PROJECTS ───────────────────────────────────────────── */
function ProjectsPage() {
  const { PROJECTS, G_USERS } = window.GideonData;
  const [q, setQ] = p2UseState('');
  const [status, setStatus] = p2UseState('all');
  const filters = [{ value: 'all', label: 'Vše' }, { value: 'active', label: 'Běží' }, { value: 'review', label: 'Ke schválení' }, { value: 'paused', label: 'Pozastaveno' }, { value: 'done', label: 'Hotovo' }];
  const rows = PROJECTS.filter(p => (status === 'all' || p.status === status) && (!q.trim() || (p.name + p.client).toLowerCase().includes(q.toLowerCase().trim())));

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Správa</div><h1>Zakázky</h1><p>Projekty napříč klienty — rozpočet, čerpání, termíny a postup.</p></div>
        <div className="actions"><button className="b b--primary"><GIc.plus />Nová zakázka</button></div>
      </div>
      <TableToolbar q={q} setQ={setQ}
        filters={<div style={{ display: 'flex', gap: 8 }}>{filters.map(s => <button key={s.value} className={'fchip' + (status === s.value ? ' on' : '')} onClick={() => setStatus(s.value)}>{s.label}</button>)}</div>} />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Projekt</th><th>Typ</th><th style={{ width: 180 }}>Postup</th><th className="r">Rozpočet</th><th className="r">Vyčerpáno</th><th>Termín</th><th>Garant</th><th>Stav</th></tr></thead>
          <tbody>
            {rows.map(p => {
              const over = p.budget && p.spent > p.budget;
              return (
                <tr key={p.id}>
                  <td><div className="cell-main"><div><div className="nm2">{p.name}</div><div className="sub2">{p.client}</div></div></div></td>
                  <td style={{ color: 'var(--text-2)' }}>{p.type}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface-3)' }}>
                        <div style={{ width: p.progress + '%', height: '100%', borderRadius: 3, background: p.status === 'done' ? 'var(--c-ok)' : 'var(--c-signal)' }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', width: 32, textAlign: 'right' }}>{p.progress}%</span>
                    </div>
                  </td>
                  <td className="r money">{p.budget ? money(p.budget) : '—'}</td>
                  <td className="r money" style={{ color: over ? 'var(--c-danger)' : 'var(--text-2)' }}>{p.spent ? money(p.spent) : '—'}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(p.deadline)}</td>
                  <td><GAvatar who={p.owner} size="sm" /></td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="tbl-foot"><span>{rows.length} zakázek</span></div>
      </div>
    </div>
  );
}

/* ── INVOICES ───────────────────────────────────────────── */
function InvoicesPage() {
  const { INVOICES } = window.GideonData;
  const [q, setQ] = p2UseState('');
  const [status, setStatus] = p2UseState('all');
  const filters = [{ value: 'all', label: 'Vše' }, { value: 'paid', label: 'Zaplacené' }, { value: 'sent', label: 'Odeslané' }, { value: 'overdue', label: 'Po splatnosti' }];
  const rows = INVOICES.filter(i => (status === 'all' || i.status === status) && (!q.trim() || (i.id + i.client).toLowerCase().includes(q.toLowerCase().trim())));
  const sum = rows.reduce((s, i) => s + i.amount, 0);
  const overdueSum = INVOICES.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
  const paidSum = INVOICES.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Správa</div><h1>Faktury</h1><p>Vystavené faktury, jejich stav a splatnost.</p></div>
        <div className="actions"><button className="b b--outline"><GIc.upload />Export</button><button className="b b--primary"><GIc.plus />Nová faktura</button></div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat"><div className="top"><span className="lbl">Zaplaceno tento měsíc</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-ok) 14%, transparent)', color: 'var(--c-ok)' }}><GIc.check /></span></div><div className="val">{money(paidSum)}</div></div>
        <div className="stat"><div className="top"><span className="lbl">Po splatnosti</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-danger) 14%, transparent)', color: 'var(--c-danger)' }}><GIc.invoice /></span></div><div className="val" style={{ color: 'var(--c-danger)' }}>{money(overdueSum)}</div></div>
        <div className="stat"><div className="top"><span className="lbl">Celkem evidováno</span><span className="ic" style={{ background: 'color-mix(in srgb, var(--c-signal) 14%, transparent)', color: 'var(--c-signal)' }}><GIc.spark /></span></div><div className="val">{money(INVOICES.reduce((s, i) => s + i.amount, 0))}</div></div>
      </div>

      <TableToolbar q={q} setQ={setQ}
        filters={<div style={{ display: 'flex', gap: 8 }}>{filters.map(s => <button key={s.value} className={'fchip' + (status === s.value ? ' on' : '')} onClick={() => setStatus(s.value)}>{s.label}</button>)}</div>} />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Číslo</th><th>Klient</th><th>Vystaveno</th><th>Splatnost</th><th>Metoda</th><th className="r">Částka</th><th>Stav</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.id}>
                <td><span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{i.id}</span></td>
                <td style={{ color: 'var(--text-2)', fontWeight: 500 }}>{i.client}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{gFmtDate(i.issued)}</td>
                <td className="mono" style={{ fontSize: 12, color: i.status === 'overdue' ? 'var(--c-danger)' : 'var(--text-3)' }}>{gFmtDate(i.due)}</td>
                <td style={{ color: 'var(--text-3)', fontSize: 13 }}>{i.method}</td>
                <td className="r money">{money(i.amount)}</td>
                <td><StatusBadge status={i.status} /></td>
                <td><div className="rowact"><button title="Stáhnout PDF"><GIc.doc /></button><button title="Více"><GIc.more /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot"><span>{rows.length} faktur</span><span className="money" style={{ color: 'var(--text)' }}>Součet: {money(sum)}</span></div>
      </div>
    </div>
  );
}

/* ── USERS ──────────────────────────────────────────────── */
function UsersPage() {
  const { G_USERS } = window.GideonData;
  const rows = Object.values(G_USERS).map(u => ({ ...u, last: u.id === 'JP' ? 'právě teď' : u.id === 'DK' ? 'před 12 min' : 'včera · 17:40', twofa: u.id !== 'LH' }));
  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Systém</div><h1>Uživatelé &amp; role</h1><p>Kdo má přístup do administrace a s jakými právy.</p></div>
        <div className="actions"><button className="b b--primary"><GIc.plus />Pozvat člověka</button></div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Člověk</th><th>Role</th><th>2FA</th><th>Poslední aktivita</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td><div className="cell-main"><GAvatar who={u.id} /><div><div className="nm2">{u.name}</div><div className="sub2">{u.email}</div></div></div></td>
                <td><StatusBadge status={u.role === 'Owner' ? 'signal' : 'muted'} label={u.role} /></td>
                <td>{u.twofa ? <StatusBadge status="paid" label="Zapnuto" /> : <StatusBadge status="warn" label="Vypnuto" />}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{u.last}</td>
                <td><div className="rowact"><button><GIc.edit /></button><button><GIc.more /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── SETTINGS (all field types) ─────────────────────────── */
function SettingsPage() {
  const _b = window.BRAND || {};
  const [f, setF] = p2UseState({
    agency: _b.company || 'gide-on s.r.o.', web: _b.web || 'gide-on.cz', email: _b.email || 'ahoj@gide-on.cz',
    ico: _b.ico || '19283746', dic: _b.dic || 'CZ19283746', currency: 'CZK', vat: false,
    invoicePrefix: 'F', dueDays: 14, visibility: 'team',
    notifyEmail: true, notifyOverdue: true, notifyWeekly: false,
    tags: ['web', 'údržba', 'SaaS'], accent: 'var(--ph-spark)',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const accents = [['var(--ph-spark)', 'Coral'], ['var(--ph-explore)', 'Teal'], ['var(--ph-launch)', 'Green'], ['var(--ph-pause)', 'Gold']];

  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Systém</div><h1>Nastavení</h1><p>Údaje agentury, fakturace a předvolby administrace.</p></div>
      </div>

      <div className="formwrap">
        <div className="fsection">
          <div className="fsection__head"><h3>Údaje agentury</h3><p>Objeví se na fakturách a v patičce e-mailů.</p></div>
          <div className="fsection__body">
            <div className="fgrid">
              <div className="full"><label className="lab">Název firmy</label><input className="in" value={f.agency} onChange={e => set('agency', e.target.value)} /></div>
              <div><label className="lab">Web</label><input className="in" value={f.web} onChange={e => set('web', e.target.value)} /></div>
              <div><label className="lab">Kontaktní e-mail</label><input className="in" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
              <div><label className="lab">IČO</label><input className="in mono" value={f.ico} onChange={e => set('ico', e.target.value)} /></div>
              <div><label className="lab">DIČ</label><input className="in mono" value={f.dic} onChange={e => set('dic', e.target.value)} /></div>
              <div className="full"><label className="lab">Logo</label><FileDrop hint="SVG nebo PNG, na výšku min. 240 px" /></div>
            </div>
          </div>
        </div>

        <div className="fsection">
          <div className="fsection__head"><h3>Fakturace</h3><p>Výchozí hodnoty pro nově vystavené faktury.</p></div>
          <div className="fsection__body">
            <div className="fgrid">
              <div><label className="lab">Měna</label>
                <GSelect value={f.currency} onChange={v => set('currency', v)} options={[{ value: 'CZK', label: 'CZK · koruna' }, { value: 'EUR', label: 'EUR · euro' }, { value: 'USD', label: 'USD · dolar' }]} />
              </div>
              <div><label className="lab">Prefix čísla faktury</label><input className="in mono" value={f.invoicePrefix} onChange={e => set('invoicePrefix', e.target.value)} /></div>
              <div><label className="lab">Splatnost (dní)</label><input className="in mono" type="number" value={f.dueDays} onChange={e => set('dueDays', +e.target.value)} /></div>
              <div><label className="lab">Plátce DPH</label>
                <div style={{ paddingTop: 6 }}><SegRadio value={f.vat ? 'yes' : 'no'} onChange={v => set('vat', v === 'yes')} options={[{ value: 'no', label: 'Ne' }, { value: 'yes', label: 'Ano' }]} /></div>
              </div>
              <div className="full"><label className="lab">Štítky služeb</label><TagsField tags={f.tags} onChange={v => set('tags', v)} placeholder="Přidej štítek a stiskni Enter" /><div className="hint">Nabízí se při zakládání zakázky.</div></div>
            </div>
          </div>
        </div>

        <div className="fsection">
          <div className="fsection__head"><h3>Předvolby</h3><p>Vzhled a viditelnost dat v týmu.</p></div>
          <div className="fsection__body">
            <div className="fgrid">
              <div className="full"><label className="lab">Výchozí viditelnost nového klienta</label>
                <div style={{ paddingTop: 6 }}><SegRadio value={f.visibility} onChange={v => set('visibility', v)} options={[{ value: 'me', label: 'Jen já' }, { value: 'team', label: 'Tým' }, { value: 'all', label: 'Všichni' }]} /></div>
              </div>
              <div className="full"><label className="lab">Akcentní barva</label>
                <div className="optset" style={{ paddingTop: 4 }}>
                  {accents.map(([c, n]) => (
                    <button type="button" key={c} className={'opt' + (f.accent === c ? ' on' : '')} onClick={() => set('accent', c)}>
                      <span className="d" style={{ background: c, width: 12, height: 12 }} />{n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="switchrow"><div><div className="lab2">E-mail při nové aktivitě</div><div className="desc2">Souhrn změn jednou denně na {f.email}.</div></div><Switch on={f.notifyEmail} onChange={v => set('notifyEmail', v)} /></div>
              <div className="switchrow"><div><div className="lab2">Upozornění po splatnosti</div><div className="desc2">Okamžitě, když faktura překročí splatnost.</div></div><Switch on={f.notifyOverdue} onChange={v => set('notifyOverdue', v)} /></div>
              <div className="switchrow"><div><div className="lab2">Týdenní přehled</div><div className="desc2">Reportujeme tržby a stav projektů každé pondělí.</div></div><Switch on={f.notifyWeekly} onChange={v => set('notifyWeekly', v)} /></div>
            </div>
          </div>
        </div>

        <div className="savebar">
          <span className="note"><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-warn)', display: 'inline-block' }} />Neuložené změny</span>
          <button className="b b--ghost">Zahodit</button>
          <button className="b b--primary"><GIc.check />Uložit nastavení</button>
        </div>
      </div>
    </div>
  );
}

/* ── CLIENT FORM (dialog) ───────────────────────────────── */
function ClientForm({ initial, onClose, onSave }) {
  const { PLANS, G_USERS } = window.GideonData;
  const isEdit = !!(initial && initial.id);
  const [f, setF] = p2UseState({
    name: '', ico: '', contact: '', email: '', phone: '', city: '',
    status: 'lead', plan: '—', mrr: 0, owner: 'JP', since: new Date().toISOString().slice(0, 10),
    visibility: 'team', note: '', tags: [], ...(initial || {}),
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const canSave = f.name.trim() && f.contact.trim();

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" style={{ width: 'min(720px, calc(100vw - 40px))' }}>
        <div className="dlg__head">
          <div><div className="dlg__title">{isEdit ? 'Upravit klienta' : 'Nový klient'}</div><div className="dlg__sub">{isEdit ? 'Uprav údaje a ulož.' : 'Založ kartu klienta nebo leadu.'}</div></div>
          <button className="x" onClick={onClose}><GIc.x /></button>
        </div>
        <div className="dlg__body">
          <div className="fgrid">
            <div className="full"><label className="lab">Název / firma</label><input className="in" autoFocus value={f.name} onChange={e => set('name', e.target.value)} placeholder="Např. Kavárna Pulz" /></div>
            <div><label className="lab">Kontaktní osoba</label><input className="in" value={f.contact} onChange={e => set('contact', e.target.value)} placeholder="Jméno a příjmení" /></div>
            <div><label className="lab">IČO</label><input className="in mono" value={f.ico} onChange={e => set('ico', e.target.value)} placeholder="12345678" /></div>
            <div><label className="lab">E-mail</label><input className="in" type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="kontakt@firma.cz" /></div>
            <div><label className="lab">Telefon</label><input className="in mono" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="+420…" /></div>
            <div><label className="lab">Město</label><input className="in" value={f.city} onChange={e => set('city', e.target.value)} placeholder="Praha" /></div>
            <div><label className="lab">Klientem od</label>
              <div style={{ position: 'relative' }}><input className="in" type="date" value={f.since} onChange={e => set('since', e.target.value)} /></div>
            </div>
            <div><label className="lab">Stav</label>
              <GSelect value={f.status} onChange={v => set('status', v)} options={[{ value: 'lead', label: 'Lead' }, { value: 'active', label: 'Aktivní' }, { value: 'paused', label: 'Pozastaveno' }, { value: 'archived', label: 'Archiv' }]}
                render={o => <><StatusBadge status={o.value} /></>} />
            </div>
            <div><label className="lab">Plán</label>
              <GSelect value={f.plan} onChange={v => set('plan', v)} options={PLANS.map(p => ({ value: p, label: p }))} render={o => <span className="mono" style={{ fontSize: 13 }}>{o.label}</span>} />
            </div>
            <div><label className="lab">Měsíční paušál (Kč)</label><input className="in mono" type="number" value={f.mrr} onChange={e => set('mrr', +e.target.value)} placeholder="0" /></div>
            <div className="full"><label className="lab">Garant</label>
              <div className="optset">
                {Object.values(G_USERS).map(u => (
                  <button type="button" key={u.id} className={'opt' + (f.owner === u.id ? ' on' : '')} onClick={() => set('owner', u.id)}>
                    <GAvatar who={u.id} size="sm" />{u.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="full"><label className="lab">Viditelnost</label>
              <div style={{ paddingTop: 4 }}><SegRadio value={f.visibility} onChange={v => set('visibility', v)} options={[{ value: 'me', label: 'Jen já' }, { value: 'team', label: 'Tým' }, { value: 'all', label: 'Všichni' }]} /></div>
            </div>
            <div className="full"><label className="lab">Štítky</label><TagsField tags={f.tags} onChange={v => set('tags', v)} /></div>
            <div className="full"><label className="lab">Poznámka</label><textarea className="in" value={f.note} onChange={e => set('note', e.target.value)} placeholder="Kontext, domluvené podmínky, na co nezapomenout…" /></div>
          </div>
        </div>
        <div className="dlg__foot">
          <button className="b b--ghost" onClick={onClose}>Zrušit</button>
          <button className="b b--primary" disabled={!canSave} onClick={() => onSave(f)}>{isEdit ? 'Uložit změny' : 'Vytvořit klienta'}</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ProjectsPage, InvoicesPage, UsersPage, SettingsPage, ClientForm });
