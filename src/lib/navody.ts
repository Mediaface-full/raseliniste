/**
 * Návody — Petrova interní wiki k modulům Rašeliniště.
 *
 * Strukturovaný markdown obsah, jeden objekt per modul. Vykresluje se
 * v `/navody` (grid) a `/navody/[slug]` (detail).
 *
 * Petr to může postupně rozšiřovat — stačí editovat hodnoty stringů
 * (markdown podporován přes `marked`). Při přidání nového modulu přidej
 * nový objekt do `NAVODY` arraye a hotovo.
 */

export interface Navod {
  slug: string;
  title: string;
  /** Lucide icon name (přes astro-icon `lucide:*`) */
  icon: string;
  /** Pastel tint name z Tailwind config — peach/mint/butter/sky/rose/lavender/sage/pink */
  tint: "peach" | "mint" | "butter" | "sky" | "rose" | "lavender" | "sage" | "pink";
  /** Jedna věta na boxíku v gridu */
  oneLiner: string;
  /** URL primárního zobrazení modulu (pro tlačítko „Otevřít") */
  href?: string;
  /** Sekce — markdown */
  sections: {
    co_to_je: string;
    jak_to_ovladam: string;
    proc: string;
    co_umi: string;
    co_neumi: string;
    napojeni: string;
  };
}

export const NAVODY: Navod[] = [
  {
    slug: "ukoly",
    title: "Úkoly",
    icon: "lucide:check-square",
    tint: "peach",
    oneLiner: "Diktuju, mažu, deleguju — vše obousměrně do Todoistu.",
    href: "/ukoly",
    sections: {
      co_to_je: `
**Úkoly** = můj vlastní task model (\`Task\`) plně synchronizovaný s Todoistem oběma směry.
Todoist je primární tool, Rašeliniště je sběrna a smart router pro delegování.
      `,
      jak_to_ovladam: `
- Manuálně: \`/ukoly\` → tlačítko **+ Nový úkol** (titulek, popis, datum, tagy, kontakt)
- Hlasově: \`/ukoly\` → **Nadiktovat úkoly** → AI extrahuje strukturované úkoly → review screen
- **Audio soubor**: \`/ukoly\` → **📎 Nahrát soubor** → vyber mp3/m4a/wav přímo (mobile-friendly,
  bez redirectu) → upload → auto-redirect na review \`/ukoly/audio/<id>/review\`
- **Inline editace v listu**: klik na nadpis úkolu = okamžitý edit (Tab/Enter ukládá, Escape ruší)
- **Review screen — vše inline**: datum (native picker), priorita (select), kontakt (select s týmem + klienty),
  tagy (čárka), poznámka (textarea), trvání (t-* dropdown). Žádné rozkliknout edit panel.
- **Chip „📁 Projekt / Sekce"** v review = preview kam úkol půjde v Todoistu (live podle změny kontaktu/tagů)
- Edit/done/reopen/delete přímo v listu
- VIP přes /call-log — když mi VIP pošle zprávu s termínem, vznikne úkol v projektu „Lidé"
      `,
      proc: `
Mám ADHD a CPTSD. Když mi něco prolétne hlavou, musím to vyklopit dřív než to zapomenu — proto hlasový diktát.
Když delegování trvá víc než 30 sekund, neudělám ho — proto smart routing do správného Todoist projektu.
      `,
      co_umi: `
- 5stage AI pipeline: přepis (Flash) → cleanup → strukturovaná extrakce (Pro) → review → push
- **Triage UI s t-* dropdown** (NOVÉ 05-10) — v review screenu Hourglass dropdown s pevným setem trvání: \`t-30m\` / \`t-1h\` / \`t-2h\` / \`t-půlden\` / \`t-celý-den\` / \`t-?\`. Hodnota se ukládá jako extra tag.
- **Smart routing 6-úrovňový** (NOVÉ 05-10):
  1. tag \`klient-<slug>\` → projekt „Práce" / sekce klienta
  2. \`assignedToContact.clientTag\` → Práce / sekce
  3. \`assignedToContact.isTeam\` → Práce / sekce <jméno>
  4. obecný kontakt → top-level shared project nebo Lidé / sekce
  5. tag z config mapy (např. \`dum\` → Osobní/Domov) → konfigurovatelný projekt/sekce
  6. fallback → mojeUkoly / Inbox
- **t-\* tagy** filtrované z routing logiky (jen meta, neovlivňují cíl)
- **Auto-create projektu/sekce** při neexistenci, logované do RoutingAuditLog
- **Routing audit log** v \`/settings/crons\` — tabulka 30 posledních push s pravidlem + auto-create flagy
- **AI prompt** dostává distinct seznam clientSlugs z DB + pravidla proti halucinaci slugu (žádné fuzzy úpravy existujících)
- **Dlouhé nahrávky 30+ min** (NOVÉ 05-27): žádný strop na počet úkolů, prompt instruuje „klidně 100, 200 úkolů, nekonsoliduj", token limit 60k + nízký thinkingBudget. Verified: 29min audio → 36 úkolů. Pojistka: tolerantní JSON parser sní přebytky a root array.
- **Todoist responsible_uid** (NOVÉ 05-27): Contact.todoistUserId mapuje kontakty na Workspace usery. Při push se posílá assignment = člen týmu dostane reálnou notifikaci. ID najdeš na \`/api/integrations/todoist/collaborators\`.
- Parent + children (subtasks)
- Tagy: dynamicky z \`Task.tags\` + \`TodoistLabelMirror\`
- Filtry: status (open/done/all), assignee (me/all/per kontakt), tagy
- VIP mise zobrazené v /ukoly s ⭐ badge (z CallLog)
      `,
      co_neumi: `
- **Recurring tasks** v Todoistu — naše DB má jen single \`dueAt\`, recurrence se rozjede
- DELETE leak když je Todoist down — lokální delete proběhne, Todoist task zůstane
- Idempotency-Key header při createTask (race duplikáty)
- Cleanup audit logu — RoutingAuditLog neomezeně roste, řešit když překročí 10k záznamů
      `,
      napojeni: `
- **Todoist** (obousměrný sync à 5 min, lib \`todoist-sync.ts\`)
- **Ozvěna** — audio diktát úkolů
- **Kontakty** — assignee picker, smart routing (\`Contact.isTeam\` + \`Contact.clientTag\`)
- **Firewall (VIP)** — VIP zpráva s termínem vytvoří úkol
- **Things import** — bulk import z Things 3 přes \`/things-import\`
- **Dashboard** — KPI „X otevřených, Y dnes, Z přes termín"
- **/settings/integrations** — Smart routing config (praceProjectName, peopleProjectName, tagToProject)
- **Operativní návod:** \`INSTRUKCE/SMART-ROUTING.md\`
      `,
    },
  },

  {
    slug: "studanka",
    title: "Studánka",
    icon: "lucide:waves",
    tint: "butter",
    oneLiner: "Sdílená nahrávárna pro klienty — token URL, AI rozbor.",
    href: "/studna",
    sections: {
      co_to_je: `
**Studánka** = sdílené projektové boxíky. Pozvu klienta/hosta přes email, dostane URL \`/me/<token>\`,
nahrává hlasový vstup z mobilu. AI mi to přepíše a strukturovaně rozebere.
DB tabulka \`ProjectBox\` (\`isPrivate=false\`).
      `,
      jak_to_ovladam: `
- \`/studna\` — list všech projektů
- \`/studna/<id>\` — detail projektu se 4 záložkami:
  - **Záznamy** — všechny nahrávky chronologicky
  - **Hosti** — pozvánky, per-host nastavení (Klíčový brief, Zachovávat audio)
  - **Souhrny** — AI agregace napříč nahrávkami (markdown)
  - **Nastavení** — model, prompty, archivace
- \`/studna/nahravka\` — owner recorder (já) s grid dlaždicemi projektů
- \`/studna/aktivita\` — všechny nahrávky napříč projekty seskupené per den
      `,
      proc: `
S klienty potřebuju sběrnu hlasových vstupů co se sama strukturuje. Bez Studánky bych přepisoval hlasovky ručně.
Token URL = klient nemusí účet. Rate limit 20/h chrání před zneužitím.
      `,
      co_umi: `
- **STANDARD** (Flash, max 10 min) — rychlá AI analýza
- **BRIEF** (Pro, max 90 min, file upload) — hluboký rozbor s glossary, actors, decision_history
- AI extrakce: summary, key_themes, thoughts (importance + category), open_questions, sentiment
- **Per-projekt prompty** + Gemini model override (Auto/Flash/Pro)
- **Vlastní prompt pro Souhrn projektu** — Gemini Pro dostane plné transkripty
- **Per-host „Zachovávat audio"** (NOVÉ 2026-05-06) — audio se nemaže po 14 dnech
- **Per-host „Klíčový brief"** — povolí dlouhé brief nahrávky
- Guest text-only vzkaz (bez audia)
- Audio retention: STANDARD 14 dní (transkript zůstává), BRIEF navždy
- Záchrana stuck recordings — tlačítko „zrušit" → status error → Regenerovat
- **Hostův výpis 5 posledních záznamů** s plným přepisem na \`/me/<token>\`
      `,
      co_neumi: `
- Backfill RAG indexu pro existující záznamy (nové se indexují automaticky)
- Per-projekt ikona (všechny mají waves)
- Šifrování end-to-end — nahrávky leží v plain na serveru
      `,
      napojeni: `
- **Hosté** — \`GuestUser\` model, callLogToken (defense-in-depth s VIP firewallem)
- **Zeptat se (RAG)** — auto-indexace nových nahrávek do pgvector
- **Daily digest cron** (7:00) — emaill o aktivitě za 24 h
- **Cleanup-audio cron** (3:00) — STANDARD audio po 14 dnech (kromě \`keepAudio=true\`)
- **Retry-stuck cron** (15 min) — auto-restart processing
      `,
    },
  },

  {
    slug: "prskavka",
    title: "Prskavka",
    icon: "lucide:sparkles",
    tint: "rose",
    oneLiner: "Můj kreativní prostor — knížky, podcast, biografie. Sdílí kód se Studánkou.",
    href: "/prskavka",
    sections: {
      co_to_je: `
**Prskavka** = osobní kreativní projekty (knížky, podcast, biografie, brainstormy).
Sdílí stejný kód jako Studánka — \`ProjectBox\` s \`isPrivate=true\`.
Rozdíl: jsem tu sám, žádní hosté, žádné token URL.
      `,
      jak_to_ovladam: `
- \`/prskavka\` — list projektů + výpis posledních 5 záznamů s plným přepisem
- Otevři projekt → diktuj jako u Studánky
- Pro brainstormy: nech BRIEF s vlastním promptem pro Souhrn projektu (mapa kapitol, index osob, časová osa)
      `,
      proc: `
Když píšu knížku nebo nahrávám podcast, audio je primární materiál — ne dočasná nahrávka.
Proto se v Prskavce **nic nemaže** automaticky.
      `,
      co_umi: `
- Stejné co Studánka (STANDARD, BRIEF, AI rozbor, vlastní prompty, model override)
- **Audio retention navždy** — cleanup-audio cron Prskavku přeskakuje (\`isPrivate=true\`)
- Audio se smaže pouze při smazání projektu
- **Výpis 5 posledních záznamů** na \`/prskavka\` (NOVÉ 2026-05-06) — vidím kde jsem skončil
- Ideální pro plné transkripty s vlastním promptem na Souhrn (mapa kapitol, bílá místa)
      `,
      co_neumi: `
- Hosté/sdílení — z designu (jsem tu sám)
- Per-segment komentování — celý transkript je atomic
      `,
      napojeni: `
- **Studánka** — sdílí kód, schema, AI pipeline
- **Zeptat se (RAG)** — auto-indexace
- **DELETE endpoint** — při smazání projektu cascade smaže \`ProjectRecording\` rows + audio soubory na disku
      `,
    },
  },

  {
    slug: "kalendar",
    title: "Kalendář",
    icon: "lucide:calendar",
    tint: "sky",
    oneLiner: "Den / Týden / Měsíc — orientace pro time-blind mozek.",
    href: "/calendar",
    sections: {
      co_to_je: `
3 pohledy + 1 quick-add. Sjednocený model \`CalendarEvent\` s 4 zdroji.
Synchronizovaný s Google + iCloud syn (RODINA) + iCloud partnerka.
      `,
      jak_to_ovladam: `
- **Den** \`/day/<datum>\` — vertikální timeline pro mobil. Pixel-perfect pozicování.
- **Týden** \`/calendar/tyden/<datum>\` — desktop, 7 sloupců, hover tooltip s detailem.
- **Měsíc** \`/calendar/mesic/<YYYY-MM>\` — orientační heatmap, hover tooltip seznam dne.
- **Quickadd** \`/quickadd\` — hlasový/textový vstup nové události s verdiktem GREEN/YELLOW/RED.
- **Naplno mód** \`?naplno=1\` — Base layout místo Shell, rituální prostor pro nedělní pohled.
- **Tisk** — \`@media print\` A4 landscape s transform scale.
- **Topbar quick-access** Den/Týden/Měsíc na všech Shell stránkách.
      `,
      proc: `
Mám time blindness (Russell Barkley). Textový seznam událostí nedokážu rychle skenovat —
mozek potřebuje vidět **prostor**: kde v dni jsem, co mě obklopuje, co je největší věc dne.
      `,
      co_umi: `
- Barva = zdroj (sky=já, rose=partnerka, mint=syn, butter=ostatní, peach=rituál, pink=výročí)
- Long event (>3h) co overlapuje krátký = pozadí s opacity 0.55
- All-day spanning přes víc dní = jeden vizuální blok
- **Rituály** — peach + tečkovaný + ✨, 3 default + custom (CustomRitual tabulka)
- **Výročí** — pink + 🕯 (Anniversary tabulka, NEpropisuje se zpět do Google/iCloud)
- **Now čára** terakota napříč všemi sloupci
- Past eventy ztlumené (opacity 0.45)
- **Hover tooltip** sleduje kurzor (Portal-rendered, 80 ms delay)
- **Klik = fixed modal** s plným popisem (Portal, neutíká pod scroll)
- **Úkoly tento týden pod gridem** (NOVÉ 05-10) — plochý seznam Tasků s dueAt v okně Po-Ne, výška karty úměrná t-* tagu (30/60/120/240/480 px). Sticky header s počtem + součtem hodin. Tint per kategorie (sky=klient, rose=high priority, lavender=delegace, peach=vlastní). Komponenta \`WeekTasksList.tsx\`.
- **Booking link** \`/i/<token>\` pro klienty
      `,
      co_neumi: `
- Drag-and-drop — záměrně, není potřeba a komplikuje kód
- Vlastní opakující se eventy v Rašeliništi (jen Anniversary + CustomRitual)
- Statistiky průměrů přes víc týdnů — Petr nepotřebuje meta-data
      `,
      napojeni: `
- **Google Calendar API** (lib \`google-calendar.ts\`) — \`singleEvents:true\`, recurring server-side
- **iCloud CalDAV** (lib \`icloud-calendar.ts\`) — recurring expand klientsky s jump-forward iterátorem
- **OOO management** \`/calendar/away\` — vytvoří v Google all-day event
- **Booking** \`/calendar/invite\` — zarezervuje slot, vytvoří Google event + Meet
- **Calendar prep AI** — z popisu eventu extrahuje \`itemsToBring\`
- **Ozvěna** — Quickadd hlasový vstup
- **Briefing cron** (22:00) — agreguje zítřejší \`itemsToBring\` do Todoist tasku
      `,
    },
  },

  {
    slug: "ozvena",
    title: "Ozvěna",
    icon: "lucide:mic",
    tint: "peach",
    oneLiner: "Diktát úkolů a deníku. Stage 1 přepis, Stage 2 strukturovaná extrakce.",
    href: "/ozvena",
    sections: {
      co_to_je: `
Sjednocený hlasový vstup pro úkoly i deník. URL parametr \`?mode=task\` nebo \`?mode=journal\`
přepne pipeline. Wake Lock + visibility ochrana zabraňuje uspání mobilu při nahrávání.
      `,
      jak_to_ovladam: `
- \`/ozvena?mode=task\` — diktát úkolů
- \`/ozvena?mode=journal\` — diktát deníku
- Klik mikrofon → mluvit → stop → Stage 1 (Flash) přepis + cleanup výplňových slov → Stage 2 (Pro pro Brief, Flash pro Standard) extrakce JSON
- Pro úkoly: review screen s navrženými tasky (titulek, kontakt, datum, tagy, parent/children) → schválit/odmítnout per task
- Pro deník: AI strukturuje na METADATA + tělo + POZNÁMKY EDITORA + NÁPADY (ty se sloučí do Knowledge)
      `,
      proc: `
Když mi něco prolétne hlavou, mám max 10 sekund na zachycení než to ADHD pohltí.
Tlačítko mikrofon na home screenu = nulová friction. AI udělá zbytek.
      `,
      co_umi: `
- Stage 1 (Flash) — surový přepis + cleanup
- Stage 2 (Flash/Pro) — JSON v daném schema
- Tagy: dynamicky z DB (\`Task.tags\` + \`TodoistLabelMirror\`)
- Kontakty: dynamicky z DB pro AI extrakci „pro Mortyka"
- Sentimenty u úkolů
- Wake Lock + Permissions-Policy microphone=(self) fix Android
- Záchrana přerušené nahrávky přes localStorage
      `,
      co_neumi: `
- Real-time streaming přepis — počítáme až po stopu
- Diarizace (rozlišení mluvčích)
- Per-user training pro vlastní slovník
      `,
      napojeni: `
- **Úkoly** — propsání po review do \`Task\` + auto-push do Todoistu
- **Deník** — propsání do \`JournalEntry\`
- **Knowledge** — NÁPADY z deníku se extrahují
- **Audio retention** — \`audioRetainForever\` toggle
      `,
    },
  },

  {
    slug: "denik",
    title: "Deník",
    icon: "lucide:book-open",
    tint: "butter",
    oneLiner: "Vlastní JournalEntry — hlasový/textový, AI strukturuje, měsíční review.",
    href: "/denik",
    sections: {
      co_to_je: `
Samostatný model \`JournalEntry\` — nesouvisí s Entry/Task. Hlasový (Ozvěna) i textový vstup.
AI strukturuje podle CPTSD/ADHD-aware promptu: METADATA + tělo + POZNÁMKY EDITORA + NÁPADY.
      `,
      jak_to_ovladam: `
- \`/denik\` — list záznamů
- \`/denik/<id>/edit\` — detail/edit
- \`/denik/review/YYYY-MM\` — měsíční review (Vertex Pro, jen METADATA + POZNÁMKY EDITORA)
- Vyhledávání: fulltext (bodyMarkdown + transcript + title) + filtry (lidé z LIDÉ, tagy z TÉMATA, datum, mood)
- Identifier \`denik_RRRR-MM-DD\` v UI + tlačítko Stáhnout \`.txt\`
- **Surový přepis (rawTranscript)** je vždy zachován vedle editovaného bodyMarkdown — v detailu pod sekcí „Surový přepis" (collapsed). AI úpravy se NEPŘEPISUJÍ přes originál.
      `,
      proc: `
Klasický deník je pro mě moc volný. CPTSD potřebuje strukturu — metadata, mood, lidé, tagy.
Měsíční review mi ukáže vzorce co bych si sám neviděl (vývoj, nedořešené nitky, lidé co se opakují).
      `,
      co_umi: `
- AI strukturace per zápis (Flash/Pro) — METADATA hlavička s DATUM, NÁLADA, LIDÉ, TÉMATA, UDÁLOSTI, KLÍČOVÉ MOMENTY, NÁPADY
- **Auto-tagy z TÉMATA** — lowercase, bez háčků, max 8 (filtruje se v UI chip listu)
- **Auto-lidé z LIDÉ** — zachovává původní case (Karel, Dominik), max 12, filter chips
- **Auto-highlights z KLÍČOVÉ MOMENTY** — pro rychlou orientaci, max 5
- **Auto-nálada (mood enum)** — heuristic mapping z NÁLADA řádku na enum hodnotu
- Surový přepis (rawTranscript) zachovaný vedle editovaného textu — nikdy se nepřepíše
- Měsíční review jen z METADATA + POZNÁMKY (tělo se nečte → nevidí privátní detaily)
- Audio retention 7 dní (\`audioRetainForever\` toggle ho zachová navždy)
- Filtry: lidé/tagy/datum/mood (v UI chip listu vpravo)
- Stahování \`.txt\`
- Petr 2026-05-27: AI prompt explicitně **zachovává jazyk uživatele** (sarkasmus, vulgarismy, neologismy, přezdívky). Nikdy neformalizuje, necenzuruje, nepsychologizuje.
      `,
      co_neumi: `
- E2E šifrování — záznamy jsou v plain DB
- Hlasové vyhledávání („najdi mi zápis o…")
- Shared journals — z designu (single-user)
      `,
      napojeni: `
- **Ozvěna** — hlasový vstup
- **Knowledge** (NÁPADY extrakce)
- **Zeptat se (RAG)** — auto-indexace nových zápisů
- **Měsíční review** — Vertex Pro
      `,
    },
  },

  {
    slug: "zeptat-se",
    title: "Zeptat se",
    icon: "lucide:search",
    tint: "lavender",
    oneLiner: "RAG nad mými deníky / úkoly / Studna nahrávkami s [N] citacemi.",
    href: "/zeptat-se",
    sections: {
      co_to_je: `
AI dotaz nad indexovanými zápisy. pgvector (768 dim) + Gemini text-embedding-004
+ Gemini 2.5 Pro pro generování odpovědi s \`[N]\` citacemi do zdroje.
      `,
      jak_to_ovladam: `
- \`/zeptat-se\` — text input → odeslat → výsledek s citacemi
- Klik na \`[N]\` → otevře zdroj
- Auto-indexace nových zápisů (deník, úkoly, Studna nahrávky)
      `,
      proc: `
ADHD = mám tisíce roztroušených fragmentů. Klasický fulltext mi nepomůže.
Sémantické vyhledávání s citací = mohu se zeptat „co jsem říkal o X v posledních 6 měsících" a dostanu shrnutí + zdroje.
      `,
      co_umi: `
- pgvector cosine similarity over text-embedding-004 (768 dim)
- Top-K retrieval + Pro generation s citačním promptem
- Multi-source: deníky + úkoly + Studna transkripty
- Auto-indexace přes hooks v create endpointech
      `,
      co_neumi: `
- **Backfill** historických dat — záměrně ne (Petr chtěl „jen od teď", 2026-04-30)
- Multi-turn konverzace (každý dotaz je nezávislý)
- Filtry per source/datum (zatím)
      `,
      napojeni: `
- **Postgres pgvector** — image \`pgvector/pgvector:pg16\`
- **Deník / Úkoly / Studna** — auto-indexace přes hooks
- **Gemini API** — embedding + Pro generation
- Lib \`src/lib/rag.ts\`
      `,
    },
  },

  {
    slug: "bwmys",
    title: "Myši",
    icon: "lucide:arrow-left-right",
    tint: "lavender",
    oneLiner: "Rozhodovací linka pro emocionální rozhodovací styl. 14denní sběr → AI verdikt.",
    href: "/bwmys",
    sections: {
      co_to_je: `
Strukturovaný rozhodovací systém. Místo „rozhodnout teď" sbírám 14 dní vstupy
(audio nebo text), AI je klasifikuje podle Six Hats, na konci vyhodnotí verdikt + „co by ho překlopilo".
      `,
      jak_to_ovladam: `
- \`/bwmys\` — list otevřených/uzavřených rozhodnutí
- Otevřu nové → titulek + kontext → 14 dní zapisuju entries (hlasově/textově)
- Cron \`bwmys-tick\` (denně 7:10) — AI klasifikace nových entries
- Po 14 dnech → finální AI vyhodnocení (sekce A-H) + verdikt
- Vizualizace: Six Hats radar, křivka nálad, donut typů, mřížka argumentů (smer × konzistence)
      `,
      proc: `
Mám CPTSD — emocionální rozhodování v jeden moment je past. Potřebuju strukturu která mi řekne
„co jsem říkal před 10 dny", protože si to nepamatuju.
      `,
      co_umi: `
- 5 AI promptů: varianty, mini-tick, finální, klasifikace úhlů, extrakce argumentů
- Audio recording entries (Stage 1 Flash + Stage 2 metadata)
- Cron-driven daily processing (\`bwmys-tick\` denně 7:10)
- 5 vizualizačních vrstev:
  - **Decision Compass** (primární, NOVÉ 2026-05-06) — SVG kompas se 4 kvadranty (silný signál PRO/PROTI nahoře, šum strach/euforie dole) + verdikt v centru s labelem "opřený o sever/východ/jih/západ"
  - SixHatsRadar — kolik zápisů v každé Six Hats kategorii
  - MoodCurve — křivka nálad v čase
  - EntryTypesDonut — distribuce \`typVstupu\`
  - ArgumentsGrid — drill-down ScatterChart \`smer × konzistence\`
- Reopening — pokud změním názor po závěru, můžu znovu otevřít (s explicitním "novým faktem")
- Doplněk 2: \`stavSystemu\` (aktivovaný/stažený/klidný) blokuje uzávěr v afektu — nabídne odložení o 48 h
      `,
      co_neumi: `
- Multi-user pro sdílená rozhodnutí (single-user)
- Export verdiktu jako PDF
- Drag-and-drop reorder argumentů
      `,
      napojeni: `
- **Ozvěna pattern** — Stage 1+2 audio pro entries
- **Cron scheduler** \`/api/cron/scheduler\` → \`bwmys-tick\`
- Lib \`src/lib/bwmys-ai.ts\` (5 promptů) + \`src/lib/bwmys-colors.ts\` (HAT_COLORS + COMPASS_HAT_COLORS)
- Komponenty \`src/components/BwMysViz/\` (DecisionCompass, SixHatsRadar, MoodCurve, EntryTypesDonut, ArgumentsGrid)
- Detailní metodologie: [INSTRUKCE/BWMYS-METODOLOGIE.md](#) (frameworky de Bono, Klein, Kahneman, Welch, Heath bros, Porges, Bezos)
      `,
    },
  },

  {
    slug: "zijes",
    title: "ŽIJEŠ?",
    icon: "lucide:heart-pulse",
    tint: "rose",
    oneLiner: "Denní 90sekundový check-in. Stav, energie, naladění, zpráva budoucímu já.",
    href: "/zijes",
    sections: {
      co_to_je: `
Krátký denní formulář — 4 pole, max 90 sekund. Cron pošle push notifikaci ráno.
Pokud nevyplním, **stane se nic** — žádné napomínání, žádný streak.
      `,
      jak_to_ovladam: `
- \`/zijes\` — formulář (stav, energie, naladění, zpráva)
- Push notifikace ráno (cron \`zijes-reminder\`)
- Historie — jednoduchý list
      `,
      proc: `
CPTSD = ztrácím kontakt sám se sebou. Krátký check-in mi vrátí baseline.
**Žádný streak / gamifikace** — to by způsobilo úzkost při výpadku.
      `,
      co_umi: `
- 4 strukturovaná pole
- Push reminder ráno
- Tichá tolerance výpadků
      `,
      co_neumi: `
- Připomínat se opakovaně (záměrně)
- Trendy / grafy (zatím)
- AI rozbor zprávy (zatím)
      `,
      napojeni: `
- **Push notifikace** (Web Push)
- **Cron scheduler**
      `,
    },
  },

  {
    slug: "vyroci",
    title: "Výročí",
    icon: "lucide:calendar-heart",
    tint: "pink",
    oneLiner: "Manuální seznam — svatba, úmrtí, narozeniny mimo kontakty.",
    href: "/vyroci",
    sections: {
      co_to_je: `
Samostatná tabulka \`Anniversary\` — manuální záznamy které **nepatří do Google ani iCloud**.
Zobrazují se v Day/Week/Month + dashboard banner + /start.
      `,
      jak_to_ovladam: `
- \`/vyroci\` — list + create form
- Pole: titulek, měsíc + den, year (volitelné), poznámka
- Pokud zadán year → počítá se kolikáté („16. výročí svatby")
      `,
      proc: `
Některá výročí (úmrtí blízkých, klíčová data života) nepatří do sdílených kalendářů.
Žijí jen v Rašeliništi, jen pro mě, bez expozice rodině přes shared calendars.
      `,
      co_umi: `
- Per-rok generování (month + day → virtuální allDay event)
- Pink + 🕯 v kalendáři
- Banner na dashboardu když dnes
- 14denní upcoming list
- Žádný recurrence handling — přímočaré
      `,
      co_neumi: `
- Propag do Google/iCloud (záměrně)
- Push notifikace v den (zatím)
      `,
      napojeni: `
- **Kalendář Den/Týden/Měsíc** — virtuální events přes \`generateAnniversaryEvents\`
- **Dashboard** + **/start** — banner
      `,
    },
  },

  {
    slug: "kontakty-firewall",
    title: "Kontakty + VIP firewall",
    icon: "lucide:users",
    tint: "lavender",
    oneLiner: "Standardní kontakty + soukromý kanál pro VIP přes token URL.",
    href: "/contacts",
    sections: {
      co_to_je: `
Kontakty — jméno, telefon, email, narozeniny, vztah, poznámky, vokativ (5. pád).
**VIP firewall** — vybraní lidé mají \`callLogToken\` (24 znaků base64url, 144 bit entropie).
URL \`/call-log?t=<token>\` — VIP napíše vzkaz, vznikne CallLog + push notifikace + Todoist mise.
      `,
      jak_to_ovladam: `
- \`/contacts\` — list a edit
- VIP toggle → auto-vygeneruje token + privátní URL
- Klik „Regenerovat" zruší předchozí link (defense-in-depth)
- VIP vidí v \`/call-log/thanks\` „Giďoušovy mise" pokud jsem mu dal úkol
      `,
      proc: `
Mám firewall mezi „kdokoliv" a „rodina/klíčoví klienti". VIP má prioritu — okamžitá push,
texty „Gíďo, máš misi", vokativ z DB. Cross-VIP průsak fyzicky nemožný (audit 8 míst).
      `,
      co_umi: `
- Token-based privátní VIP kanál
- Auto-detekce VIP přes \`?phone=\` nebo \`?t=<token>\`
- Vokativ v textech (5. pád z DB)
- VIP termín → Todoist \`due_date\` (od 2026-05-03 bez termínu = bez data, Today se neplní)
- Mise na \`/call-log/thanks\` — VIP vidí co mu zbývá
- Backfill tlačítko v \`/contacts\` pro existující VIP bez tokenu
- **Smart routing fields (05-10):** \`isTeam\` checkbox (kolega/dlouhodobý spolupracovník) + \`clientTag\` slug (kontaktní osoba klienta). Badges v listu: mint „tým", sky „klient-{slug}".
- **Alias systém (05-10):** \`aliases\` (synonyma jména v audiu — „Karel", „Kája") + \`clientTagAliases\` (synonyma klient slugu — „TK", „Tékáčko"). AI v extract promptu fuzzy match přes všechna synonyma, ale do JSON/tagu vždy KANONICKÁ hodnota. Comma-separated input s chip listem v edit modalu.
- **iCloud auto-sync (NOVÉ 05-27):** cron \`sync-contacts-icloud\` à 30 min pullne změny z mobilu + onMount \`/contacts\` tichu pullne (rate-limit 30s). Předtím byl iCloud sync jen manuální button v /contacts/tabulka. Google sync běží přes \`sync-contacts\` cron denně 4:00.
- **Todoist user ID (NOVÉ 05-27):** \`todoistUserId\` pro členy týmu (isTeam=true). Když je vyplněné, push úkolů do Todoistu posílá \`responsible_uid\` = člen týmu dostane reálnou notifikaci v Todoistu. Bez ID se úkol jen vytvoří v sekci s jménem, ale asignovaný zůstává Petrovi. ID najdeš na \`/api/integrations/todoist/collaborators\`.
      `,
      co_neumi: `
- Sdílení kontaktu mezi víc adresářů
- Hromadný import z Google Contacts (ručně)
- Šifrování per-VIP
      `,
      napojeni: `
- **Firewall** \`/firewall\` — historie zpráv s rose badge u VIP s termínem
- **Úkoly** — VIP termín → \`Task\` + Todoist; aliases + clientTag pro smart routing
- **Push notifikace** — VIP zpráva
- **Dopisy** — recipient picker
- **AI extract** (Ozvěna) — \`process-task-audio.ts\` predává seznam kontaktů s aliases ve formátu „Karel Novák (aka TK, Tékáčko)"
      `,
    },
  },

  {
    slug: "dopisy",
    title: "Dopisy",
    icon: "lucide:mail-plus",
    tint: "butter",
    oneLiner: "AI 'učesat' + PDF + odeslání emailem. Multi-sender (já / OSVČ / s.r.o.).",
    href: "/letters",
    sections: {
      co_to_je: `
Editor dopisu s AI „Učesat" funkcí (Gemini Pro). PDF přes \`@react-pdf/renderer\`,
email přes Resend. Multiple senders s vlastními podpisy.
      `,
      jak_to_ovladam: `
- \`/letters\` — list rozepsaných + odeslaných
- \`/letters/new\` — editor (sender, recipient, předmět, tělo)
- „Učesat" → AI návrh formálnější verze
- „Vytvořit PDF" → preview + stáhnout/odeslat
- „Odeslat emailem" → Resend
      `,
      proc: `
Když píšu klientům formální dopisy, zacyklím se na formulacích. AI „učesat" dá draft
za 5 sekund — ušetří mi 30 minut.
      `,
      co_umi: `
- Multi-sender (Petr Gideon Peřina / OSVČ / s.r.o.)
- AI „učesat" (Gemini Pro)
- PDF generování (\`react-pdf/renderer\`)
- Email přes Resend (S/MIME?)
- Recipients picker z Kontaktů
      `,
      co_neumi: `
- Šablony / boilerplate (zatím)
- E-podpis
- Hromadné odeslání
      `,
      napojeni: `
- **Kontakty** — recipient picker
- **Settings → Letter senders** — odesílatelé
- **Resend API** — email odeslání
      `,
    },
  },

  {
    slug: "zdravi",
    title: "Zdraví",
    icon: "lucide:heart-pulse",
    tint: "rose",
    oneLiner: "Health Auto Export iPhone → 17 metrik + ECG + AI měsíční report.",
    href: "/health",
    sections: {
      co_to_je: `
Auto-feed z iPhone aplikace Health Auto Export přes \`POST /api/health-ingest\` (x-api-key).
17 metrik + ECG. AI měsíční analýza nad daty.
      `,
      jak_to_ovladam: `
- \`/health\` — 6 sekcí (Přehled / Aktivita / Srdce / Spánek / Tělo / Tlak) + 3 status dlaždice
- \`/settings/ingest\` — JSON upload (jednorázový roční import bez API tokenu)
- \`/health/analyza/<id>\` — full page report (markdown), tlačítka Stáhnout (.md) / Tisk
- Cron \`monthly-health-report\` (poslední den měsíce) — AI analýza → email
      `,
      proc: `
Sleduju trendy (HRV, klid v noci, kondice) — bez auto-feedu bych to nevedl. AI mi řekne co se mění.
      `,
      co_umi: `
- 17 metrik + ECG idempotentně (unique index)
- Per-day agregace (HAE posílá nap+noční jako 2 rows)
- AI manuální analýza (Gemini Pro) přes date range + focus presety
- Status dlaždice — poslední import / měření / 24 h
- Stáhnout markdown / Tisk PDF
      `,
      co_neumi: `
- Real-time alerts (zatím)
- Garmin / Whoop integrace (zatím)
      `,
      napojeni: `
- **Health Auto Export iPhone** (auto-feed)
- **Email reporty** (cron)
- Lib \`src/lib/health-query.ts\` + \`health-analyze.ts\`
      `,
    },
  },

  {
    slug: "page-links",
    title: "Page Links",
    icon: "lucide:link",
    tint: "sky",
    oneLiner: "Vlastní odkazy v sidebaru — name + barva + URL, otevírá v novém okně.",
    href: "/links",
    sections: {
      co_to_je: `
User-defined web shortcuts. Místo browser bookmarks mít v Rašeliništi
panel oblíbených webů (ARES, banka, klientovy weby, dashboardy serverů,
Plex, Immich, atd.). Boxíky jak na /start, klik = nové okno.
      `,
      jak_to_ovladam: `
- \`/links\` — grid boxíků (target="_blank", rel="noopener noreferrer")
- \`/settings/page-links\` — CRUD UI
- Sidebar entry „Page Links" pod Dashboard
- Form: NÁZEV + URL + TintPicker (8 barev) + volitelně ikona
- Ikona — lowercase kebab-case z **lucide.dev/icons** (např. \`camera\`, \`image\`, \`video\`, \`mail\`, \`globe\`)
- Brand jména typu „Immich" / „PhotoPrism" NEFUNGUJÍ — fallback na globe
      `,
      proc: `
Petr 2026-05-27: chce z Rašeliniště přistupovat k externím webům bez
přepínání do browser bookmarks. Jednoduché shortcut grid.
      `,
      co_umi: `
- 8 tints (peach/mint/lavender/sky/sage/butter/rose/pink) per link
- Volitelná lucide icon (kebab-case lowercase)
- Order field (manipulable přes API PATCH, UI drag-and-drop zatím není)
- Per-user ownership (ne shared)
- Empty state s tlačítkem „+ Přidat první odkaz"
- safeIconName guard — neplatná ikona = fallback globe (nepadne SSR)
      `,
      co_neumi: `
- Drag-and-drop reorder v UI (manuálně přes PATCH order field)
- Skupiny / kategorie (zatím flat list)
- Sdílení mezi uživateli (z designu — single-user)
- Auto-generated icony z URL favicon (možný future feature)
      `,
      napojeni: `
- **Sidebar** — Shell.astro nav „Page Links" v sekci Přehled
- **Settings index** — /settings/page-links link mezi integrations
- **Lucide icons** — kebab-case names z lucide.dev/icons (validate přes
  safeIconName helper v /links.astro)
      `,
    },
  },

  {
    slug: "notifikace",
    title: "Notifikace",
    icon: "lucide:bell",
    tint: "butter",
    oneLiner: "Agregace urgentních věcí — urgent maily, nové Studánka záznamy, VIP zprávy.",
    href: "/notifikace",
    sections: {
      co_to_je: `
Tile na /start vede sem. Sbírá z 3 zdrojů co potřebuje akci, ne všechno
napříč modulech. Petr nemusí scannovat 4 různá místa, aby viděl co je
urgentní.
      `,
      jak_to_ovladam: `
- \`/start\` → tile **Notifikace** (zvonek, butter tint) s badge počtu
- \`/notifikace\` → list karet, klik proklikne na detail
- Karty mají chip typu (Studánka/Pošta/VIP) + ago timestamp + rozkliknutelné summary
- Empty state „Nic nového. Klid." pokud nic urgent
      `,
      proc: `
Petr 2026-05-27 #7: na mobilním dashboardu chci vědět co potřebuje akci
hned, ne procházet jednotlivé moduly. Notifikace = single point of urgency.
      `,
      co_umi: `
- Pošta: EmailMessage s action_required + (urgency=high OR escalation=true), za 48 h
- Studánka: ProjectRecording z posledních 24 h ve status=processed
  (nový obsah ke kontrole — owner nebo host)
- VIP: CallLog wasVip=true za 48 h
- Sortováno DESC podle času — nejnovější nahoře
- Žádný cron pro list, vše live z DB při otevření
- **Web Push notifikace** (NOVÉ 2026-05-27): cron \`push-notifications\` à 5 min
  pošle Web Push na mobilní device pro 4 zdroje (VIP / urgent mail / nová Studánka
  od hosta / confirmed booking). Petr si v /settings/push vybere které posílat.
  iOS push vyžaduje PWA mode + iOS 16.4+. VAPID klíče v .env.
      `,
      co_neumi: `
- Mark-as-read flow v /notifikace listu (zatím notifikace mizí jen časem 24-48 h)
- Filter v UI listu (jen pošta / jen VIP / …) — push má per-source filtry,
  /notifikace list zatím ne
      `,
      napojeni: `
- **Pošta** — EmailClassification (action_required, urgency, escalation)
- **Studánka** — ProjectRecording (status=processed)
- **VIP firewall** — CallLog (wasVip=true)
- **/start tile** — badge počtu aktivních notifikací (countNotifications)
      `,
    },
  },

  {
    slug: "booking",
    title: "Booking pozvánka",
    icon: "lucide:send",
    tint: "sage",
    oneLiner: "Vytvořím link s nabídkou termínů, klient zarezervuje, vznikne Google event + Meet + mail s .ics.",
    href: "/calendar/invite",
    sections: {
      co_to_je: `
Public booking flow. Vytvořím invite link \`/i/<token>\`, klient klikne, vidí volné sloty,
zarezervuje. Auto-create Google Calendar event s Meet linkem + dva potvrzovací maily
(náš + Google nativní invite) + .ics příloha pro libovolný kalendář.
      `,
      jak_to_ovladam: `
- \`/calendar/invite\` — vytvoření linku
- Vyber kontakt nebo „univerzální" (cold lead zadá email při rezervaci)
- Mode (klient/přítel), typ schůzky (Praha/online/u Petra), délka
- Volitelně **„Sloty dostupné od"** (datum) — klient uvidí sloty až od něj
- Volitelně **„Poznámka pro hosta"** — uvidí ji v rezervační stránce,
  v Google eventu i v .ics
- „Vygenerovat link" → URL + zelený box, zkopíruj a pošli klientovi
- Klient \`/i/<token>\` → sloty (přísnější z globálního lead time + availableFrom)
  → potvrdí → dorazí mail s Meet linkem + .ics + Google nativní invite
- Pokud někomu mail nedorazil: tlačítko **„Poslat znovu"** u pozvánky v listu
- Pro debug otevři \`/api/booking/<id>/diagnose\` — vrátí celý řetězec
  (status, meetLink, contact email, MailLog záznamy, verdict)
      `,
      proc: `
Když dohazuju termín mailem („máš čas v úterý nebo ve středu?"), trvá to 4 maily.
Booking link = 1 mail, klient si vybere, hotovo. Plus .ics si klient přidá do
Apple/Outlook/jakéhokoli kalendáře bez ohledu na Google.
      `,
      co_umi: `
- Smart slot listing (vyloučí kolize z Google + iCloud + aktivní RESERVED/CONFIRMED bookingy)
- Verdict GREEN/YELLOW/RED podle commute checků
- Per-invite „dostupné od" datum (přísnější z toho a globálního lead time vyhrává)
- Veřejná poznámka pro hosta (picker + Google event + .ics + mail)
- Auto-create Google event + Meet link (persistovaný v DB)
- Náš confirmation mail přes SMTP2GO s .ics přílohou
- Google nativní invite (sendUpdates: all)
- „Poslat znovu" tlačítko pro CONFIRMED/RESERVED invites (s reálným Meet linkem)
- Diagnose endpoint pro debug stížností „nepřišlo mi nic"
      `,
      co_neumi: `
- Multi-time-slot offer (jen 1 termín volí)
- Round-robin pro tým (single-user)
- Magic-link confirm zrušen 2026-05-12 (přímý create Google eventu)
      `,
      napojeni: `
- **Kalendář** — sloty z Google + iCloud + aktivní bookingy
- **Locations** — commute checks
- **SMTP2GO** — confirmation emails (DKIM aligned, lepší deliverability než Seznam)
- **Google Calendar API** — create event + Meet + sendUpdates pro nativní invite
- **MailLog** — audit trail odeslaných mailů (context: booking-confirm / booking-cancel / booking-confirm-resend)
      `,
    },
  },

  {
    slug: "things-import",
    title: "Things import",
    icon: "lucide:download",
    tint: "mint",
    oneLiner: "Bulk import z Things 3 přes JSON — migrate / wishlist / discard.",
    href: "/things-import",
    sections: {
      co_to_je: `
Pro migraci úkolů z Things 3. Curated JSON → \`POST /api/things/import\` → review UI.
Pro každou položku rozhodnu: migrate (do Todoistu), wishlist (Knowledge), discard.
      `,
      jak_to_ovladam: `
- Vyexportuj z Things JSON podle schema
- \`POST /api/things/import\` (s API tokenem)
- \`/things-import/<id>\` — review UI
- Per item rozhodnutí (migrate/wishlist/discard) + Decision (target Todoist projekt, tagy, subtasks)
- Pre-flight check + DRY RUN
- „Spustit" → executeImport
- Plný error log v UI + tlačítko „Stáhnout JSON" pro AI opravy
      `,
      proc: `
Things 3 je krásný ale uzavřený. Migroval jsem do Todoistu kvůli sync s Rašeliništěm.
~30 % error rate je normální (URL formát ve wishlist, race conditions atd.) → opravený JSON re-import.
      `,
      co_umi: `
- Per item decision (migrate/wishlist/discard)
- Subtasks (parent + children v Todoistu)
- **Auto-create chybějících projektů** v Todoistu (od 2026-05-03)
- DRY RUN mode
- Plný error log + JSON export
- Před re-importem: Hard reset mirror + Wipe orphan tasks v \`/settings/crons\`
      `,
      co_neumi: `
- Inkrementální import (jen full)
- Live editing JSONu v UI
- Things-direct API (Things to nepodporuje)
      `,
      napojeni: `
- **Úkoly** + Todoist (migrate path)
- **Knowledge** (wishlist path)
- **Todoist mirror** — \`Hard reset\` + \`Wipe orphan\` v \`/settings/crons\`
      `,
    },
  },
];

export function getNavod(slug: string): Navod | null {
  return NAVODY.find((n) => n.slug === slug) ?? null;
}
