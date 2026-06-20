/* Gideon Admin · seed data */
const _BR = window.BRAND || {};
const _DOM = _BR.emailDomain || 'gide-on.cz';

const G_USERS = {
  JP: { id: 'JP', name: 'Jan Procházka', role: 'Owner',  email: 'jan@' + _DOM,     color: 'var(--ph-spark)' },
  DK: { id: 'DK', name: 'Dominik Kraus', role: 'Admin',  email: 'dominik@' + _DOM, color: 'var(--ph-explore)' },
  LH: { id: 'LH', name: 'Lucie Horká',   role: 'Editor', email: 'lucie@' + _DOM,   color: 'var(--ph-launch)' },
};

const CLIENTS = [
  { id: 'c1', name: 'Atelier Modřín', ico: '08812345', contact: 'Petr Dvořák', email: 'petr@modrin.cz', phone: '+420 605 112 233', city: 'Brno',
    status: 'active', plan: 'Care+', mrr: 8900, since: '2024-03-11', projects: 3, invoicesDue: 0, owner: 'JP', note: 'Stálý klient, web + údržba + měsíční konzultace.' },
  { id: 'c2', name: 'Kavárna Pulz', ico: '17723344', contact: 'Eva Němcová', email: 'eva@pulzkava.cz', phone: '+420 776 884 220', city: 'Praha',
    status: 'active', plan: 'Web', mrr: 0, since: '2025-01-22', projects: 1, invoicesDue: 1, owner: 'DK', note: 'Jednorázový web, řešíme follow-up na rezervační systém.' },
  { id: 'c3', name: 'Truhlářství Bárta', ico: '24551200', contact: 'Josef Bárta', email: 'josef@truhlarstvibarta.cz', phone: '+420 603 220 110', city: 'Olomouc',
    status: 'lead', plan: '—', mrr: 0, since: '2026-05-30', projects: 0, invoicesDue: 0, owner: 'JP', note: 'Poptávka na web + e-shop. Po první schůzce, čeká na nabídku.' },
  { id: 'c4', name: 'FitStudio Vlna', ico: '09988776', contact: 'Klára Urbanová', email: 'klara@vlnafit.cz', phone: '+420 720 556 901', city: 'Zlín',
    status: 'active', plan: 'Care', mrr: 4500, since: '2024-09-02', projects: 2, invoicesDue: 0, owner: 'LH', note: 'Web + rezervace lekcí, klientská zóna ve výhledu.' },
  { id: 'c5', name: 'Vinařství Hroznová', ico: '26113450', contact: 'Tomáš Reich', email: 'tomas@hroznova.cz', phone: '+420 607 330 221', city: 'Mikulov',
    status: 'paused', plan: 'Web', mrr: 0, since: '2023-06-18', projects: 1, invoicesDue: 2, owner: 'DK', note: 'Pozastaveno na žádost klienta — sezónní provoz.' },
  { id: 'c6', name: 'Advokátka Šimková', ico: '88001122', contact: 'Jana Šimková', email: 'kancelar@aksimkova.cz', phone: '+420 602 441 778', city: 'Praha',
    status: 'active', plan: 'Care+', mrr: 7200, since: '2025-04-14', projects: 1, invoicesDue: 0, owner: 'JP', note: 'Prezentační web + GDPR + měsíční úpravy obsahu.' },
  { id: 'c7', name: 'Pekárna U Kláska', ico: '45667788', contact: 'Marek Klásek', email: 'marek@uklaska.cz', phone: '+420 775 119 004', city: 'Hradec Králové',
    status: 'lead', plan: '—', mrr: 0, since: '2026-06-04', projects: 0, invoicesDue: 0, owner: 'LH', note: 'Nová poptávka přes formulář, zatím neoslovo­váno.' },
  { id: 'c8', name: 'Realitka Sever', ico: '63002110', contact: 'Ondřej Malý', email: 'ondrej@realitkasever.cz', phone: '+420 608 220 553', city: 'Liberec',
    status: 'active', plan: 'Care', mrr: 5400, since: '2024-11-27', projects: 2, invoicesDue: 1, owner: 'DK', note: 'Web s napojením na realitní feed, pravidelná údržba.' },
];

const PROJECTS = [
  { id: 'p1', name: 'Web + údržba', client: 'Atelier Modřín', clientId: 'c1', status: 'active', progress: 72, budget: 86000, spent: 61000, deadline: '2026-07-15', owner: 'JP', type: 'Web' },
  { id: 'p2', name: 'Rezervační systém', client: 'Kavárna Pulz', clientId: 'c2', status: 'review', progress: 90, budget: 54000, spent: 49000, deadline: '2026-06-20', owner: 'DK', type: 'Aplikace' },
  { id: 'p3', name: 'E-shop nabídka', client: 'Truhlářství Bárta', clientId: 'c3', status: 'lead', progress: 5, budget: 0, spent: 0, deadline: '—', owner: 'JP', type: 'Nabídka' },
  { id: 'p4', name: 'Klientská zóna', client: 'FitStudio Vlna', clientId: 'c4', status: 'active', progress: 38, budget: 120000, spent: 44000, deadline: '2026-09-01', owner: 'LH', type: 'SaaS' },
  { id: 'p5', name: 'Redesign webu', client: 'Advokátka Šimková', clientId: 'c6', status: 'active', progress: 55, budget: 68000, spent: 37000, deadline: '2026-07-30', owner: 'JP', type: 'Web' },
  { id: 'p6', name: 'Realitní feed v2', client: 'Realitka Sever', clientId: 'c8', status: 'paused', progress: 20, budget: 92000, spent: 18000, deadline: '2026-10-10', owner: 'DK', type: 'Integrace' },
  { id: 'p7', name: 'Web sezóna 2026', client: 'Vinařství Hroznová', clientId: 'c5', status: 'done', progress: 100, budget: 48000, spent: 48000, deadline: '2026-04-02', owner: 'DK', type: 'Web' },
];

const INVOICES = [
  { id: 'F2026-0142', client: 'Kavárna Pulz', clientId: 'c2', amount: 32670, issued: '2026-05-28', due: '2026-06-11', status: 'overdue', method: 'Převod' },
  { id: 'F2026-0141', client: 'Vinařství Hroznová', clientId: 'c5', amount: 14520, issued: '2026-05-20', due: '2026-06-03', status: 'overdue', method: 'Převod' },
  { id: 'F2026-0140', client: 'Realitka Sever', clientId: 'c8', amount: 5400, issued: '2026-06-01', due: '2026-06-15', status: 'sent', method: 'Převod' },
  { id: 'F2026-0139', client: 'Atelier Modřín', clientId: 'c1', amount: 8900, issued: '2026-06-01', due: '2026-06-15', status: 'paid', method: 'Trvalý příkaz' },
  { id: 'F2026-0138', client: 'Advokátka Šimková', clientId: 'c6', amount: 7200, issued: '2026-06-01', due: '2026-06-15', status: 'paid', method: 'Převod' },
  { id: 'F2026-0137', client: 'FitStudio Vlna', clientId: 'c4', amount: 4500, issued: '2026-06-01', due: '2026-06-15', status: 'paid', method: 'Trvalý příkaz' },
  { id: 'F2026-0136', client: 'Vinařství Hroznová', clientId: 'c5', amount: 9200, issued: '2026-04-22', due: '2026-05-06', status: 'overdue', method: 'Převod' },
  { id: 'F2026-0135', client: 'Atelier Modřín', clientId: 'c1', amount: 23000, issued: '2026-05-12', due: '2026-05-26', status: 'paid', method: 'Převod' },
];

const ACTIVITY = [
  { who: 'DK', text: 'označil fakturu <b>F2026-0139</b> jako zaplacenou', at: 'před 12 min', color: 'var(--c-ok)' },
  { who: 'JP', text: 'přidal klienta <b>Truhlářství Bárta</b>', at: 'před 40 min', color: 'var(--c-signal)' },
  { who: 'LH', text: 'posunul <b>Klientská zóna</b> do fáze realizace', at: 'před 2 h', color: 'var(--c-info)' },
  { who: 'DK', text: 'vystavil fakturu <b>F2026-0140</b> · 5 400 Kč', at: 'před 3 h', color: 'var(--c-signal)' },
  { who: 'JP', text: 'odeslal nabídku klientovi <b>Kavárna Pulz</b>', at: 'včera · 16:20', color: 'var(--c-warn)' },
  { who: 'LH', text: 'nahrála 3 soubory k projektu <b>Redesign webu</b>', at: 'včera · 11:05', color: 'var(--c-info)' },
];

const REVENUE = [
  { m: 'Led', v: 38, prev: 30 }, { m: 'Úno', v: 42, prev: 33 }, { m: 'Bře', v: 51, prev: 40 },
  { m: 'Dub', v: 47, prev: 44 }, { m: 'Kvě', v: 63, prev: 49 }, { m: 'Čvn', v: 58, prev: 52 },
];

/* breakdown výnosů podle typu služby — pro donut */
const REVENUE_MIX = [
  { label: 'Web', value: 41, c: 'var(--c-signal)' },
  { label: 'Údržba (Care)', value: 28, c: 'var(--c-info)' },
  { label: 'SaaS', value: 19, c: 'var(--c-ok)' },
  { label: 'One-off', value: 12, c: 'var(--c-warn)' },
];

/* denní návštěvnost webu (30 dní) — pro sparkline */
const TRAFFIC = [12,14,11,17,16,21,19,18,24,22,20,26,23,28,25,24,30,27,33,29,31,36,34,38,35,40,37,43,41,46];

const PLANS = ['—', 'Web', 'Care', 'Care+'];
const CLIENT_STATUS = ['lead', 'active', 'paused', 'archived'];

/* ── ANALYTICS ──────────────────────────────────────────── */
/* projekty podle typu — pro sloupcový graf */
const PROJECTS_BY_TYPE = [
  { label: 'Web', value: 14, c: 'var(--c-signal)' },
  { label: 'Care', value: 9, c: 'var(--c-info)' },
  { label: 'SaaS', value: 5, c: 'var(--c-ok)' },
  { label: 'E-shop', value: 4, c: 'var(--c-warn)' },
  { label: 'Integrace', value: 3, c: 'var(--c-violet)' },
];
/* akviziční trychtýř */
const FUNNEL = [
  { label: 'Návštěvy formuláře', value: 1240, c: 'var(--c-info)' },
  { label: 'Poptávky', value: 286, c: 'var(--c-explore-2)' },
  { label: 'Schůzky', value: 94, c: 'var(--c-signal)' },
  { label: 'Nabídky', value: 47, c: 'var(--ph-pause)' },
  { label: 'Podepsáno', value: 23, c: 'var(--c-ok)' },
];
/* heatmapa aktivity · 7 dní × 12 hodin (8–20) */
const HEATMAP = (() => {
  const days = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const rng = (d, h) => {
    if (d >= 5) return Math.floor(Math.random() * 3);          // víkend slabý
    if (h < 1 || h > 9) return Math.floor(Math.random() * 4);  // okraje dne
    return 2 + Math.floor(Math.random() * 7);                   // pracovní špička
  };
  return days.map((d, di) => ({ day: d, cells: Array.from({ length: 12 }, (_, h) => rng(di, h)) }));
})();
/* traffic zdroje */
const SOURCES = [
  { label: 'Organické hledání', value: 44, c: 'var(--c-signal)' },
  { label: 'Přímý přístup', value: 27, c: 'var(--c-info)' },
  { label: 'Sociální sítě', value: 18, c: 'var(--c-ok)' },
  { label: 'Reference', value: 11, c: 'var(--c-warn)' },
];

/* ── NOTIFICATIONS ──────────────────────────────────────── */
const NOTIFS = [
  { id: 'n1', kind: 'invoice', who: 'DK', title: 'Faktura zaplacena', text: '<b>F2026-0139</b> · 8 900 Kč od Atelier Modřín', at: 'před 12 min', read: false },
  { id: 'n2', kind: 'danger', who: null, title: 'Faktura po splatnosti', text: '<b>F2026-0142</b> · Kavárna Pulz překročila splatnost', at: 'před 1 h', read: false },
  { id: 'n3', kind: 'project', who: 'LH', title: 'Projekt posunut', text: '<b>Klientská zóna</b> přešla do fáze realizace', at: 'před 2 h', read: false },
  { id: 'n4', kind: 'client', who: 'JP', title: 'Nový lead', text: '<b>Pekárna U Kláska</b> přišla přes formulář', at: 'před 5 h', read: true },
  { id: 'n5', kind: 'mention', who: 'DK', title: 'Zmínka v poznámce', text: 'Dominik tě označil u <b>Redesign webu</b>', at: 'včera · 16:20', read: true },
  { id: 'n6', kind: 'system', who: null, title: 'Záloha dokončena', text: 'Noční záloha dat proběhla v pořádku', at: 'včera · 03:00', read: true },
  { id: 'n7', kind: 'invoice', who: 'DK', title: 'Faktura odeslána', text: '<b>F2026-0140</b> · 5 400 Kč → Realitka Sever', at: 'před 2 dny', read: true },
];

/* ── MESSAGES / INBOX ───────────────────────────────────── */
const THREADS = [
  { id: 't1', from: 'Eva Němcová', who: 'c2', email: 'eva@pulzkava.cz', subject: 'Re: Rezervační systém — zpětná vazba', preview: 'Dobrý den, prošli jsme to s týmem a máme pár drobností k formuláři…', at: '9:42', unread: true, starred: true },
  { id: 't2', from: 'Petr Dvořák', who: 'c1', email: 'petr@modrin.cz', subject: 'Faktura za červen', preview: 'Díky, fakturu jsme zaplatili. Potvrzení v příloze.', at: 'včera', unread: true, starred: false },
  { id: 't3', from: 'Josef Bárta', who: 'c3', email: 'josef@truhlarstvibarta.cz', subject: 'Poptávka — web + e-shop', preview: 'Dobrý den, rádi bychom poptali nový web s e-shopem na míru…', at: 'po', unread: false, starred: true },
  { id: 't4', from: 'Klára Urbanová', who: 'c4', email: 'klara@vlnafit.cz', subject: 'Re: Klientská zóna', preview: 'Super, termín nám vyhovuje. Kdy můžeme začít s podklady?', at: 'po', unread: false, starred: false },
  { id: 't5', from: 'Ondřej Malý', who: 'c8', email: 'ondrej@realitkasever.cz', subject: 'Realitní feed — výpadek', preview: 'Zdravím, dnes ráno se nenačítaly nové nabídky. Můžete kouknout?', at: '5. 6.', unread: false, starred: false },
];

/* ── CALENDAR (červen 2026) ─────────────────────────────── */
const CAL_EVENTS = [
  { date: '2026-06-03', title: 'Schůzka · Truhlářství', kind: 'meeting' },
  { date: '2026-06-05', title: 'Deadline · Realitní feed', kind: 'deadline' },
  { date: '2026-06-11', title: 'Splatnost F2026-0142', kind: 'invoice' },
  { date: '2026-06-15', title: 'Splatnost 3 faktur', kind: 'invoice' },
  { date: '2026-06-18', title: 'Review · Rezervační systém', kind: 'review' },
  { date: '2026-06-18', title: 'Call · FitStudio Vlna', kind: 'meeting' },
  { date: '2026-06-20', title: 'Deadline · Rezervační systém', kind: 'deadline' },
  { date: '2026-06-24', title: 'Workshop #JeDnoDuse', kind: 'meeting' },
  { date: '2026-06-30', title: 'Měsíční fakturace', kind: 'invoice' },
];

/* ── FILES ──────────────────────────────────────────────── */
const FILES = [
  { id: 'f1', name: 'smlouva-modrin-2024.pdf', kind: 'pdf', size: '240 kB', client: 'Atelier Modřín', at: '2026-06-01', by: 'JP' },
  { id: 'f2', name: 'logo-pulz-podklady.zip', kind: 'zip', size: '4,1 MB', client: 'Kavárna Pulz', at: '2026-05-28', by: 'DK' },
  { id: 'f3', name: 'brief-web-barta.docx', kind: 'docx', size: '56 kB', client: 'Truhlářství Bárta', at: '2026-05-30', by: 'JP' },
  { id: 'f4', name: 'ceník-služeb-2026.xlsx', kind: 'xlsx', size: '31 kB', client: '—', at: '2026-05-12', by: 'JP' },
  { id: 'f5', name: 'hero-fitstudio.jpg', kind: 'img', size: '1,8 MB', client: 'FitStudio Vlna', at: '2026-05-20', by: 'LH' },
  { id: 'f6', name: 'wireframe-rezervace.png', kind: 'img', size: '820 kB', client: 'Kavárna Pulz', at: '2026-05-18', by: 'DK' },
  { id: 'f7', name: 'gdpr-sablona.pdf', kind: 'pdf', size: '180 kB', client: 'Advokátka Šimková', at: '2026-04-30', by: 'JP' },
  { id: 'f8', name: 'export-feed-sever.csv', kind: 'csv', size: '12 kB', client: 'Realitka Sever', at: '2026-06-02', by: 'DK' },
  { id: 'f9', name: 'prezentace-vino.pdf', kind: 'pdf', size: '3,2 MB', client: 'Vinařství Hroznová', at: '2026-03-22', by: 'DK' },
  { id: 'f10', name: 'video-intro.mp4', kind: 'video', size: '18 MB', client: '—', at: '2026-02-14', by: 'LH' },
  { id: 'f11', name: 'fonts-spacegrotesk.zip', kind: 'zip', size: '640 kB', client: '—', at: '2026-01-30', by: 'JP' },
  { id: 'f12', name: 'analytika-q1.xlsx', kind: 'xlsx', size: '94 kB', client: '—', at: '2026-04-04', by: 'JP' },
];
const FILE_KIND_COLOR = {
  pdf: 'var(--c-danger)', docx: 'var(--c-info)', xlsx: 'var(--c-ok)', csv: 'var(--c-ok)',
  zip: 'var(--ph-pause)', img: 'var(--c-violet)', video: 'var(--c-signal)', other: 'var(--ph-archive)',
};

/* ── AUDIT LOG ──────────────────────────────────────────── */
const AUDIT = [
  { id: 'a1', who: 'DK', action: 'invoice.paid', target: 'F2026-0139', cat: 'Faktury', ip: '93.99.12.4', at: '2026-06-18 09:42' },
  { id: 'a2', who: 'JP', action: 'client.create', target: 'Truhlářství Bárta', cat: 'Klienti', ip: '88.100.4.2', at: '2026-06-18 09:05' },
  { id: 'a3', who: 'LH', action: 'project.move', target: 'Klientská zóna → realizace', cat: 'Projekty', ip: '77.75.78.9', at: '2026-06-18 08:11' },
  { id: 'a4', who: 'DK', action: 'invoice.create', target: 'F2026-0140', cat: 'Faktury', ip: '93.99.12.4', at: '2026-06-17 17:30' },
  { id: 'a5', who: 'JP', action: 'settings.update', target: 'Fakturace · splatnost 14 dní', cat: 'Systém', ip: '88.100.4.2', at: '2026-06-17 14:02' },
  { id: 'a6', who: 'LH', action: 'file.upload', target: '3 soubory · Redesign webu', cat: 'Soubory', ip: '77.75.78.9', at: '2026-06-16 11:05' },
  { id: 'a7', who: 'JP', action: 'auth.login', target: 'Přihlášení z Chrome · Praha', cat: 'Bezpečnost', ip: '88.100.4.2', at: '2026-06-16 08:40' },
  { id: 'a8', who: 'DK', action: 'user.invite', target: 'lucie@gide-on.cz', cat: 'Systém', ip: '93.99.12.4', at: '2026-06-15 16:20' },
  { id: 'a9', who: 'JP', action: 'client.delete', target: 'Testovací s.r.o. (archivace)', cat: 'Klienti', ip: '88.100.4.2', at: '2026-06-15 10:14' },
  { id: 'a10', who: 'LH', action: 'auth.2fa', target: '2FA aktivováno', cat: 'Bezpečnost', ip: '77.75.78.9', at: '2026-06-14 19:55' },
];
const AUDIT_CATS = ['Vše', 'Klienti', 'Projekty', 'Faktury', 'Soubory', 'Systém', 'Bezpečnost'];

/* ── ROLES & PERMISSIONS ────────────────────────────────── */
const ROLES = [
  { key: 'owner', name: 'Owner', desc: 'Plný přístup vč. fakturace a smazání účtu', count: 1, c: 'var(--c-signal)' },
  { key: 'admin', name: 'Admin', desc: 'Správa klientů, projektů, uživatelů', count: 1, c: 'var(--c-info)' },
  { key: 'editor', name: 'Editor', desc: 'Obsah a projekty, bez fakturace', count: 1, c: 'var(--c-ok)' },
  { key: 'viewer', name: 'Viewer', desc: 'Pouze náhled, bez úprav', count: 0, c: 'var(--ph-archive)' },
];
const PERM_GROUPS = [
  { group: 'Klienti', perms: [
    { label: 'Zobrazit klienty', m: { owner: 1, admin: 1, editor: 1, viewer: 1 } },
    { label: 'Vytvářet a upravovat', m: { owner: 1, admin: 1, editor: 1, viewer: 0 } },
    { label: 'Mazat / archivovat', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
  ]},
  { group: 'Faktury', perms: [
    { label: 'Zobrazit faktury', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
    { label: 'Vystavovat faktury', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
    { label: 'Měnit nastavení DPH', m: { owner: 1, admin: 0, editor: 0, viewer: 0 } },
  ]},
  { group: 'Projekty', perms: [
    { label: 'Zobrazit projekty', m: { owner: 1, admin: 1, editor: 1, viewer: 1 } },
    { label: 'Spravovat projekty', m: { owner: 1, admin: 1, editor: 1, viewer: 0 } },
  ]},
  { group: 'Systém', perms: [
    { label: 'Spravovat uživatele', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
    { label: 'Měnit nastavení', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
    { label: 'Audit log', m: { owner: 1, admin: 1, editor: 0, viewer: 0 } },
    { label: 'Integrace & API klíče', m: { owner: 1, admin: 0, editor: 0, viewer: 0 } },
  ]},
];

/* ── NEWSLETTER ─────────────────────────────────────────── */
const CAMPAIGNS = [
  { id: 'cmp1', subject: 'Jarní úklid webu · 5 tipů', sent: '2026-06-10', recipients: 842, open: 38.4, click: 6.1, status: 'sent' },
  { id: 'cmp2', subject: 'Case study: Rezervace pro Kavárnu Pulz', sent: '2026-05-22', recipients: 818, open: 41.2, click: 8.7, status: 'sent' },
  { id: 'cmp3', subject: 'Co je #JeDnoDuse a proč vám pomůže', sent: '2026-05-02', recipients: 790, open: 35.0, click: 4.9, status: 'sent' },
  { id: 'cmp4', subject: 'Léto v gide-on · novinky', sent: '—', recipients: 0, open: 0, click: 0, status: 'draft' },
  { id: 'cmp5', subject: 'Webinář: SEO základy', sent: '2026-06-25', recipients: 860, open: 0, click: 0, status: 'scheduled' },
];
const SUBSCRIBERS = { total: 862, active: 824, unsub: 38, growth: '+46' };

/* ── PAGES (web CMS) ────────────────────────────────────── */
const WEB_PAGES = [
  { id: 'w1', title: 'Domů', path: '/', status: 'published', views: 4620, updated: '2026-06-12', by: 'JP' },
  { id: 'w2', title: 'Služby', path: '/sluzby', status: 'published', views: 2140, updated: '2026-06-08', by: 'LH' },
  { id: 'w3', title: 'Reference', path: '/reference', status: 'published', views: 1380, updated: '2026-05-30', by: 'LH' },
  { id: 'w4', title: 'O nás', path: '/o-nas', status: 'published', views: 920, updated: '2026-05-12', by: 'JP' },
  { id: 'w5', title: 'Ceník', path: '/cenik', status: 'draft', views: 0, updated: '2026-06-16', by: 'DK' },
  { id: 'w6', title: 'Blog · #JeDnoDuse', path: '/blog', status: 'published', views: 3110, updated: '2026-06-15', by: 'LH' },
  { id: 'w7', title: 'Kontakt', path: '/kontakt', status: 'published', views: 1640, updated: '2026-04-20', by: 'JP' },
  { id: 'w8', title: 'Kariéra', path: '/kariera', status: 'scheduled', views: 0, updated: '2026-06-17', by: 'DK' },
];

window.GideonData = {
  G_USERS, CLIENTS, PROJECTS, INVOICES, ACTIVITY, REVENUE, REVENUE_MIX, TRAFFIC, PLANS, CLIENT_STATUS,
  PROJECTS_BY_TYPE, FUNNEL, HEATMAP, SOURCES, NOTIFS, THREADS, CAL_EVENTS, FILES, FILE_KIND_COLOR,
  AUDIT, AUDIT_CATS, ROLES, PERM_GROUPS, CAMPAIGNS, SUBSCRIBERS, WEB_PAGES,
};
