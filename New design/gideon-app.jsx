/* Gideon / MediaFace Admin · app shell (brand-aware via window.BRAND) */
const { useState: aUseState, useEffect: aUseEffect, useRef: aUseRef } = React;
const BRAND = window.BRAND || { kind: 'gideon', name: 'Gideon', short: 'gide-on', web: 'gide-on.cz' };

function BrandMark() {
  if (BRAND.kind === 'mediaface') {
    return (
      <span className="mf-wm mf-wm--reverse" style={{ fontSize: 21 }}>
        med<span className="mf-wm__i">ı<span className="pulse" /></span>a<span className="mf-wm__f">F</span>ace
      </span>
    );
  }
  return <span className="wm">Gide<span className="switch" />on</span>;
}

const NAV = [
  { group: 'Přehled', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { key: 'analytics', label: 'Analytika', icon: 'chart' },
    { key: 'calendar', label: 'Kalendář', icon: 'cal' },
  ]},
  { group: 'Správa', items: [
    { key: 'clients', label: 'Klienti', icon: 'users', count: 8 },
    { key: 'projects', label: 'Zakázky', icon: 'folder', count: 7 },
    { key: 'invoices', label: 'Faktury', icon: 'invoice', pip: true },
    { key: 'hatch', label: 'Nápady · Hatch', icon: 'spark' },
  ]},
  { group: 'Obsah', items: [
    { key: 'newsletter', label: 'Newsletter', icon: 'mail' },
    { key: 'pages', label: 'Stránky', icon: 'doc' },
    { key: 'files', label: 'Soubory', icon: 'files' },
  ]},
  { group: 'Komunikace', items: [
    { key: 'notifications', label: 'Oznámení', icon: 'bell', pip: true },
  ]},
  { group: 'Systém', items: [
    { key: 'users', label: 'Uživatelé', icon: 'users' },
    { key: 'roles', label: 'Role & oprávnění', icon: 'shield' },
    { key: 'audit', label: 'Audit log', icon: 'history' },
    { key: 'components', label: 'Komponenty', icon: 'grid' },
    { key: 'settings', label: 'Nastavení', icon: 'cog' },
  ]},
];
const TITLES = { dashboard: 'Dashboard', analytics: 'Analytika', calendar: 'Kalendář', clients: 'Klienti', projects: 'Zakázky', invoices: 'Faktury', hatch: 'Nápady · Hatch', newsletter: 'Newsletter', pages: 'Stránky', files: 'Soubory', notifications: 'Oznámení', users: 'Uživatelé', roles: 'Role & oprávnění', audit: 'Audit log', components: 'Komponenty', settings: 'Nastavení' };

function Sidebar({ page, onNav, open, onClose }) {
  return (
    <>
      {open && <div className="sb-scrim" onClick={onClose} />}
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="sb__brand">
          <BrandMark />
          <span className="tag-admin">Admin</span>
        </div>
        <div className="sb__search">
          <GIc.search /><input placeholder="Hledat…" /><kbd>⌘K</kbd>
        </div>
        <nav className="sb__nav">
          {NAV.map(g => (
            <div className="sb__group" key={g.group}>
              <div className="sb__glabel">{g.group}</div>
              {g.items.map(it => {
                const Icon = GIc[it.icon];
                const active = page === it.key || (page.startsWith('client') && it.key === 'clients');
                return (
                  <button key={it.key} className={'sb__item' + (active ? ' on' : '')} onClick={() => onNav(it.key)}>
                    <Icon />{it.label}
                    {it.count != null && <span className="ct">{it.count}</span>}
                    {it.pip && <span className="pip" />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sb__foot">
          <div className="sb__user">
            <GAvatar who="JP" />
            <div><div className="nm">Jan Procházka</div><div className="rl">Owner · {BRAND.short}</div></div>
            <span className="mr"><GIc.logout /></span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ page, theme, onTheme, onMenu }) {
  return (
    <div className="adminbar">
      <button className="iconbtn sb-toggle" onClick={onMenu}><GIc.menu /></button>
      <div className="crumb">
        <span>{BRAND.name}</span><GIc.chevR /><b>{TITLES[page] || 'Detail'}</b>
      </div>
      <div className="spacer" />
      <button className="iconbtn" title="Hledat"><GIc.search /></button>
      <button className="iconbtn" title="Oznámení"><GIc.bell /><span className="badge-dot" /></button>
      <button className="iconbtn" onClick={onTheme} title="Přepnout motiv">{theme === 'light' ? <GIc.moon /> : <GIc.sun />}</button>
      <div style={{ width: 1, height: 24, background: 'var(--line-2)', margin: '0 4px' }} />
      <button className="iconbtn" title="Účet" style={{ width: 'auto', padding: '0 6px', gap: 8 }}><GAvatar who="JP" size="sm" /></button>
    </div>
  );
}

function HatchTease({ onNav }) {
  return (
    <div className="page">
      <div className="pagehead">
        <div><div className="eyebrow">Obsah</div><h1>Nápady · Hatch</h1><p>Líheň byznys nápadů žije ve vlastní aplikaci. Tady je napojená přes přehled.</p></div>
        <div className="actions"><a className="b b--primary" href="Hatch Admin.html"><GIc.ext />Otevřít Hatch</a></div>
      </div>
      <div className="panel"><div className="panel__body pad" style={{ textAlign: 'center', padding: '50px 20px' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'color-mix(in srgb, var(--c-signal) 14%, transparent)', color: 'var(--c-signal)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><GIc.spark style={{ width: 26, height: 26 }} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Hatch běží samostatně</div>
        <p style={{ fontSize: 14, color: 'var(--text-3)', maxWidth: '46ch', margin: '8px auto 18px', lineHeight: 1.5 }}>Kanbanová líheň nápadů má vlastní board, list i detail. Otevři ji v samostatném okně.</p>
        <a className="b b--outline" href="Hatch Admin.html" style={{ display: 'inline-flex' }}><GIc.ext />Otevřít Hatch Admin</a>
      </div></div>
    </div>
  );
}

function GenericEmpty({ title, sub }) {
  return (
    <div className="page">
      <div className="pagehead"><div><div className="eyebrow">Obsah</div><h1>{title}</h1><p>{sub}</p></div></div>
      <div className="panel"><div className="empty"><div className="big">Připravuje se</div><div className="sm">Tahle sekce je ve výstavbě — návrh modulu na vyžádání.</div></div></div>
    </div>
  );
}

function App() {
  const [page, setPage] = aUseState(() => localStorage.getItem((BRAND.storeKey || 'gideon') + '-page') || 'dashboard');
  const [theme, setTheme] = aUseState(() => document.documentElement.getAttribute('data-theme') || 'light');
  const [clientId, setClientId] = aUseState(null);
  const [form, setForm] = aUseState(null);
  const [sbOpen, setSbOpen] = aUseState(false);
  const [toast, setToast] = aUseState(null);
  const toastRef = aUseRef(null);
  const [clients, setClients] = aUseState(() => window.GideonData.CLIENTS);

  aUseEffect(() => { localStorage.setItem((BRAND.storeKey || 'gideon') + '-page', page); }, [page]);
  aUseEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('hatch-theme', theme); }, [theme]);

  const showToast = (msg) => { if (toastRef.current) clearTimeout(toastRef.current); setToast(msg); toastRef.current = setTimeout(() => setToast(null), 3200); };

  const nav = (key) => {
    if (key === 'client-new') { setForm({}); return; }
    setClientId(null); setForm(null); setPage(key); setSbOpen(false);
    document.querySelector('.content').scrollTo(0, 0);
    window.scrollTo(0, 0);
  };

  const openClient = (id) => { setClientId(id); setPage('client-detail'); window.scrollTo(0, 0); };
  const curClient = clientId ? clients.find(c => c.id === clientId) : null;

  const saveClient = (data) => {
    if (data.id) { setClients(list => list.map(c => c.id === data.id ? { ...c, ...data } : c)); showToast('Klient uložen.'); }
    else { const id = 'c' + Date.now().toString(36); setClients(list => [{ ...data, id, projects: 0, invoicesDue: 0 }, ...list]); showToast('Klient „' + data.name + '" přidán.'); }
    setForm(null);
  };

  let body;
  if (page === 'dashboard') body = <Dashboard onNav={nav} />;
  else if (page === 'analytics') body = <AnalyticsPage />;
  else if (page === 'calendar') body = <CalendarPage />;
  else if (page === 'clients') body = <ClientsPage onOpen={openClient} onNew={() => setForm({})} />;
  else if (page === 'client-detail' && curClient) body = <ClientDetail client={curClient} onBack={() => nav('clients')} onEdit={() => setForm(curClient)} />;
  else if (page === 'projects') body = <ProjectsPage />;
  else if (page === 'invoices') body = <InvoicesPage />;
  else if (page === 'newsletter') body = <NewsletterPage />;
  else if (page === 'pages') body = <PagesPage />;
  else if (page === 'files') body = <FilesPage />;
  else if (page === 'notifications') body = <NotificationsPage />;
  else if (page === 'users') body = <UsersPage />;
  else if (page === 'roles') body = <RolesPage />;
  else if (page === 'audit') body = <AuditPage />;
  else if (page === 'components') body = <ComponentsPage />;
  else if (page === 'settings') body = <SettingsPage />;
  else if (page === 'hatch') body = <HatchTease onNav={nav} />;
  else body = <Dashboard onNav={nav} />;

  return (
    <div className="admin">
      <div className="bg-dots" />
      <Sidebar page={page} onNav={nav} open={sbOpen} onClose={() => setSbOpen(false)} />
      <div className="content">
        <Topbar page={page} theme={theme} onTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')} onMenu={() => setSbOpen(true)} />
        {body}
      </div>
      {form && <ClientForm initial={form} onClose={() => setForm(null)} onSave={saveClient} />}
      {toast && <div className="toast"><span>{toast}</span></div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
