/* Hatch · data model + seed + helpers */

const PHASES = [
  { key: 'spark',   cs: 'Jiskra',     en: 'Spark',   var: 'var(--ph-spark)',   hint: 'Nový nápad. Jiskra.' },
  { key: 'explore', cs: 'Zkoumá se',  en: 'Explore', var: 'var(--ph-explore)', hint: 'Ověřuji, sbírám podklady.' },
  { key: 'pause',   cs: 'Odložené',   en: 'Pause',   var: 'var(--ph-pause)',   hint: 'Odkládám na později.' },
  { key: 'launch',  cs: 'Spouští se', en: 'Launch',  var: 'var(--ph-launch)',  hint: 'Realizuji, jdeme do toho.' },
  { key: 'archive', cs: 'Archiv',     en: 'Archive', var: 'var(--ph-archive)', hint: 'Zavrhnuto, mimo hru.' },
];
const PHASE = Object.fromEntries(PHASES.map(p => [p.key, p]));

const MARKETS = ['CZ', 'INT', 'CZ+INT'];
const DIFFS = [
  { key: 'low',  cs: 'Nízká',   n: 1 },
  { key: 'mid',  cs: 'Střední', n: 2 },
  { key: 'high', cs: 'Vysoká',  n: 3 },
];
const DIFF = Object.fromEntries(DIFFS.map(d => [d.key, d]));
const MODELS = [
  { key: 'saas', cs: 'SaaS' },
  { key: 'oneoff', cs: 'Jednorázově' },
  { key: 'service', cs: 'Služba' },
  { key: 'marketplace', cs: 'Marketplace' },
  { key: 'other', cs: 'Jiný' },
];
const MODEL = Object.fromEntries(MODELS.map(m => [m.key, m]));
const RESOURCES = [
  { key: 'time', cs: 'Čas' },
  { key: 'tech', cs: 'Technologie' },
  { key: 'knowhow', cs: 'Know-how' },
  { key: 'money', cs: 'Peníze' },
  { key: 'people', cs: 'Lidi' },
];
const USERS = {
  GI: { id: 'GI', name: 'Gideon',  email: 'gideon@gide-on.cz', color: 'var(--ph-spark)' },
  DA: { id: 'DA', name: 'David',   email: 'david@gide-on.cz',  color: 'var(--ph-explore)' },
};

const FILE_COLORS = { pdf: 'var(--ph-spark)', png: 'var(--ph-explore)', jpg: 'var(--ph-explore)', xlsx: 'var(--ph-launch)', docx: 'var(--ph-pause)', other: 'var(--ph-archive)' };

const SEED = [
  {
    id: 'i1', title: 'AI scénáře pro workshopy', phase: 'spark', author: 'GI',
    description: 'Generátor scénářů workshopu z pár vstupů.',
    detail: 'Nástroj, který z tématu, délky a počtu účastníků vygeneruje rozpis workshopu — bloky, aktivity, timing a pomůcky. Lektor jen doladí.',
    problem: 'Příprava workshopu zabere hodiny a pokaždé se dělá od nuly.',
    market: 'CZ', difficulty: 'low', potential: 4, businessModel: 'saas',
    audience: 'Lektoři, kouči a facilitátoři.', marketSize: 'Stovky lektorů v CZ, tisíce v DACH.',
    competition: { state: 'unknown', note: 'Obecné AI nástroje ano, specializované na workshopy zatím ne.' },
    resources: ['time', 'tech', 'knowhow'], tags: ['AI', 'B2B', 'workshop'],
    links: [{ title: 'Prompt skica', url: '#', host: 'notion.so', fav: 'var(--ph-spark)' }],
    files: [{ name: 'priklady-scenaru.pdf', kind: 'pdf', size: '640 kB', date: '2. 6. 2026' }],
    comments: [{ author: 'GI', text: 'Začal bych jen s jedním formátem — návrh půldenního workshopu.', at: '2. 6. 2026 · 11:10' }],
    history: [{ author: 'GI', action: 'vytvořil nápad', at: '2. 6. 2026 · 10:55' }],
    createdAt: '2026-06-02', updatedAt: '2026-06-02',
  },
  {
    id: 'i2', title: 'Šablony pro mikro-firmy', phase: 'spark', author: 'DA',
    description: 'Hotové weby + procesy na klíč.',
    detail: 'Balíčky „firma za víkend" — web, fakturace, doménová pošta a základní procesy v jednom nasazení.',
    problem: 'Mikro-firmy nemají čas ani rozpočet skládat to po kouskách.',
    market: 'CZ+INT', difficulty: 'mid', potential: 3, businessModel: 'oneoff',
    audience: 'Začínající živnostníci a malé SRO.', marketSize: 'Desítky tisíc nových IČO ročně v CZ.',
    competition: { state: 'yes', note: 'Web buildery ano, ale ne s českými procesy a fakturací.' },
    resources: ['time', 'tech'], tags: ['web', 'šablony', 'SMB'],
    links: [], files: [],
    comments: [], history: [{ author: 'DA', action: 'vytvořil nápad', at: '1. 6. 2026 · 09:20' }],
    createdAt: '2026-06-01', updatedAt: '2026-06-01',
  },
  {
    id: 'i3', title: 'Komunitní burza lektorů', phase: 'explore', author: 'GI',
    description: 'Místo, kde se potkává poptávka a lektoři.',
    detail: 'Dvoustranný marketplace — firmy hledají lektora na téma, lektoři nabízejí termíny. Provize z propojení.',
    problem: 'Shánění lektora je dnes přes známé a náhodu.',
    market: 'CZ', difficulty: 'high', potential: 3, businessModel: 'marketplace',
    audience: 'HR a L&D oddělení vs. freelance lektoři.', marketSize: 'Střední — záleží na likviditě obou stran.',
    competition: { state: 'yes', note: 'Existují obecné marketplace, žádný čistě pro vzdělávání v CZ.' },
    resources: ['time', 'tech', 'people', 'money'], tags: ['marketplace', 'B2B', 'vzdělávání'],
    links: [{ title: 'Analýza poptávky', url: '#', host: 'notion.so', fav: 'var(--ph-explore)' }],
    files: [{ name: 'mapa-trhu.png', kind: 'png', size: '410 kB', date: '5. 6. 2026' }],
    comments: [{ author: 'DA', text: 'Likvidita bude těžká. Možná začít jako agentura, ne platforma?', at: '5. 6. 2026 · 13:30' }],
    history: [
      { author: 'GI', action: 'přesunul do Zkoumá se', at: '5. 6. 2026 · 10:00' },
      { author: 'GI', action: 'vytvořil nápad', at: '4. 6. 2026 · 16:40' },
    ],
    createdAt: '2026-06-04', updatedAt: '2026-06-05',
  },
  {
    id: 'i4', title: 'Tištěný workbook na míru', phase: 'pause', author: 'DA',
    description: 'Personalizovaný sešit pro účastníky.',
    detail: 'Z digitálního scénáře se vygeneruje tištěný workbook s logem klienta a prostorem na poznámky. Print-on-demand.',
    problem: 'Účastníci ztrácí materiály a nemají kam psát.',
    market: 'CZ', difficulty: 'low', potential: 2, businessModel: 'oneoff',
    audience: 'Firmy pořádající interní školení.', marketSize: 'Nika — doplněk k workshopům.',
    competition: { state: 'no', note: 'Spíš doplněk než samostatný produkt.' },
    resources: ['time', 'knowhow'], tags: ['print', 'doplněk'],
    links: [], files: [],
    comments: [{ author: 'GI', text: 'Hezké jako add-on, ale samo o sobě malý trh. Proto pauza.', at: '3. 6. 2026 · 18:00' }],
    history: [
      { author: 'GI', action: 'přesunul do Odložené', at: '3. 6. 2026 · 18:02' },
      { author: 'DA', action: 'vytvořil nápad', at: '3. 6. 2026 · 14:10' },
    ],
    createdAt: '2026-06-03', updatedAt: '2026-06-03',
  },
  {
    id: 'i5', title: 'Newsletter pro firmy', phase: 'launch', author: 'GI',
    description: 'Měsíční výběr trendů pro majitele SRO.',
    detail: 'Kurátorský newsletter — co se děje v technologiích, dotacích a marketingu, srozumitelně pro majitele malých firem.',
    problem: 'Majitelé SRO nemají čas sledovat trendy a tonou v šumu.',
    market: 'CZ+INT', difficulty: 'mid', potential: 4, businessModel: 'service',
    audience: 'Majitelé malých a středních firem.', marketSize: 'Velký okruh, monetizace přes sponzory + premium.',
    competition: { state: 'yes', note: 'Newsletterů je hodně, cílených na české SRO málo.' },
    resources: ['time', 'knowhow'], tags: ['newsletter', 'B2B', 'obsah'],
    links: [{ title: 'Ukázkové číslo', url: '#', host: 'beehiiv.com', fav: 'var(--ph-launch)' }],
    files: [{ name: 'redakcni-plan.xlsx', kind: 'xlsx', size: '28 kB', date: '6. 6. 2026' }],
    comments: [{ author: 'DA', text: 'První číslo ven do 14 dní. Mám rozdělané 3 témata.', at: '6. 6. 2026 · 08:15' }],
    history: [
      { author: 'GI', action: 'přesunul do Spouští se', at: '6. 6. 2026 · 08:00' },
      { author: 'GI', action: 'změnil potenciál na ★★★★', at: '5. 6. 2026 · 20:00' },
      { author: 'GI', action: 'vytvořil nápad', at: '5. 6. 2026 · 19:30' },
    ],
    createdAt: '2026-06-05', updatedAt: '2026-06-06',
  },
  {
    id: 'i6', title: 'Klientská zóna jako SaaS', phase: 'launch', author: 'GI',
    description: 'Portál pro klienty — faktury, soubory, stav.',
    detail: 'Self-service portál pro klienty SRO — faktury z iDokladu, sdílené soubory, stav zakázky a chat na jednom místě. Z interního nástroje uděláme produkt na předplatné.',
    problem: 'Klienti se ptají e-mailem „kde to je / kolik to stálo". Odpovědi se opakují a tříští.',
    market: 'INT', difficulty: 'high', potential: 5, businessModel: 'saas',
    audience: 'Agentury a freelanceři s opakovanými klienty.', marketSize: '~50 stávajících klientů jako seed, dále CZ/SK agentury.',
    competition: { state: 'yes', note: 'Obecné klientské portály existují, ale ne napojené na český iDoklad + Kimai.' },
    resources: ['time', 'tech', 'knowhow'], tags: ['SaaS', 'B2B', 'iDoklad', 'portál', 'recurring'],
    links: [
      { title: 'Figma — wireframe v0', url: '#', host: 'figma.com', fav: 'var(--ph-explore)' },
      { title: 'Konkurenční rešerše', url: '#', host: 'notion.so', fav: 'var(--ph-spark)' },
    ],
    files: [
      { name: 'analyza-trhu.pdf', kind: 'pdf', size: '1,4 MB', date: '4. 6. 2026' },
      { name: 'wireframe-board.png', kind: 'png', size: '820 kB', date: '4. 6. 2026' },
      { name: 'model-predplatne.xlsx', kind: 'xlsx', size: '36 kB', date: '5. 6. 2026' },
    ],
    comments: [
      { author: 'GI', text: 'Pojďme to postavit nad to, co už máme v SRO Manageru. Půlka backendu je hotová.', at: '4. 6. 2026 · 14:02' },
      { author: 'DA', text: 'Souhlas. Navrhuju začít jen fakturami + soubory, chat až ve v2.', at: '4. 6. 2026 · 16:20' },
    ],
    history: [
      { author: 'GI', action: 'přesunul do Spouští se', at: '5. 6. 2026 · 09:12' },
      { author: 'DA', action: 'přidal soubor', at: '5. 6. 2026 · 08:40' },
      { author: 'GI', action: 'změnil potenciál na ★★★★★', at: '4. 6. 2026 · 16:55' },
      { author: 'GI', action: 'vytvořil nápad', at: '4. 6. 2026 · 13:48' },
    ],
    createdAt: '2026-06-04', updatedAt: '2026-06-05',
  },
  {
    id: 'i7', title: 'Merch s pulzem', phase: 'archive', author: 'DA',
    description: 'Trička a placky se značkou.',
    detail: 'Limitovaná edice merche se značkou gide-on. Spíš brand awareness než byznys.',
    problem: 'Žádný akutní problém — nice-to-have.',
    market: 'CZ', difficulty: 'low', potential: 1, businessModel: 'oneoff',
    audience: 'Fanoušci značky.', marketSize: 'Marginální.',
    competition: { state: 'yes', note: 'Print-on-demand služby to zvládnou levněji.' },
    resources: ['money'], tags: ['merch', 'brand'],
    links: [], files: [],
    comments: [{ author: 'GI', text: 'Pěkné, ale teď to nedává smysl. Archiv.', at: '1. 6. 2026 · 12:00' }],
    history: [
      { author: 'GI', action: 'přesunul do Archiv', at: '1. 6. 2026 · 12:01' },
      { author: 'DA', action: 'vytvořil nápad', at: '31. 5. 2026 · 21:00' },
    ],
    createdAt: '2026-05-31', updatedAt: '2026-06-01',
  },
];

window.HatchData = { PHASES, PHASE, MARKETS, DIFFS, DIFF, MODELS, MODEL, RESOURCES, USERS, FILE_COLORS, SEED };
