# HANDOFF: B&W Myš vizualizační vrstva

**Datum:** 2026-05-02
**Status:** Schváleno k implementaci, čeká na novou Claude session
**Předchozí session:** dokončila návrh, schválen Petrovým „A/B/A".

---

## Co se má udělat

Implementovat **vizualizační vrstvu** pro modul B&W Myš (rozhodovací linka).

**Spec:** `/Users/petrperina/Downloads/rozhodovaci-system-vizualizace.md` (262 řádků)

**Hlavní zadání modulu (kontext):** `/Users/petrperina/Downloads/rozhodovaci-system-zadani.md`

---

## Petrovy schválené odpovědi

### Otázka 1: Kdy generovat Mřížku argumentů?
**ODPOVĚĎ: B — samostatný AI endpoint** `/api/bwmys/[id]/arguments`
- Vlastní prompt, samostatné API volání (~$0.005 navíc na finální vyhodnocení)
- Lze regenerovat zvlášť bez celého finalniVyhodnoceni
- Petr potvrdil cenu OK

### Otázka 2: Kam cache mřížky argumentů?
**ODPOVĚĎ: A — nový sloupec `argumentsJson Json?` v `DecisionEvaluation`**
- Migrace `add_decision_evaluation_arguments`
- NE samostatný model — mřížka má život jen s vyhodnocením

### Otázka 3: Konzistentní barvy nálad
**ODPOVĚĎ: A — zachovat aktuální** (rose→butter→sky→mint→sage)
- 1=rose, 2=butter, 3=sky, 4=mint, 5=sage
- Důvod: konzistentní s archivem, hue spectrum dává vizuální informaci
- Použito v `BwMysDetail.tsx` const `NALADA_BARVA`

---

## Plán implementace (2 commity, ~3 hod)

### COMMIT A: 3 client-side vizualizace
1. **`src/lib/bwmys-colors.ts`** — sdílené barevné konstanty
   - `MOOD_COLORS[1..5]` (rose, butter, sky, mint, sage z Tailwind tintů)
   - `HAT_COLORS` (bily=#E0E0E0, cerveny, cerny, zluty, zeleny, modry)
   - `TYPE_COLORS` (novy_fakt_zvenci=teal, nova_uvaha=neutral, napadlo_me=ztlumená, reakce_na_udalost=jiná distinctní)
   - `ARGUMENT_COLORS` (pro=mint, proti=rose)

2. **Recharts knihovna** — už nainstalovaná, používá ji `AiUsageView.tsx`. Žádný nový dependency.

3. **`src/components/BwMysViz/`** složka:
   - `index.tsx` — wrapper s grid layoutem 2×2, sbalitelný, placeholdery
   - `SixHatsRadar.tsx` — Recharts `RadarChart`, 6 os, vyplněná plocha, ikona „chybí" pro 0
   - `MoodCurve.tsx` — Recharts `LineChart`, body s barvou dle MOOD_COLORS, hover tooltip s prvními 50 znaky obsahu, vodorovná čára 3, varování při range >= 3
   - `EntryTypesDonut.tsx` — Recharts `PieChart` s `innerRadius`, střed = celkový počet, textový komentář dle distribuce

4. **Integrace do `BwMysDetail.tsx`**:
   - Nová sekce `<BwMysViz />` mezi "Zarámování" (cca řádek 195) a "Časová osa zápisů" (cca řádek 205)
   - Sbalitelná, default rozbalená
   - Aktualizace pomocí `key={d.entries.length}` nebo prop

5. **Min počty zápisů (placeholdery)**:
   - Radar: od 1 zápisu s klasifikovaným úhlem (uhelPohledu != "nevybrano" NEBO uhelPohleduAi != null)
   - Křivka: od 2 zápisů
   - Donut: od 3 zápisů

### COMMIT B: AI mřížka + integrace do finálního vyhodnocení
1. **DB migrace** `add_decision_evaluation_arguments`:
   ```prisma
   model DecisionEvaluation {
     ...
     argumentsJson Json?  // [{argument, smer, konzistence, cetnost, nalady_vyskytu}]
   }
   ```

2. **`src/lib/bwmys-ai.ts`** — nová funkce `extractArguments(decision, entries) → Argument[]`
   - **Prompt** (viz níže, taky v této session diskutován):
   ```
   Jsi asistent pro rozhodovací analýzu. Z níže uvedených zápisů uživatele
   extrahuj DISTINCT argumenty (ne citace, ale shrnutí témat) a jejich pozici
   v rozhodovací matici.

   ROZHODNUTÍ:
   - Otázka: {otazka}
   - Varianty: {varianty}

   ZÁPISY ({N}):
   [1] {datum} | nálada {1-5} | typ {typVstupu} | úhel {uhelPohledu}
   {obsah}
   ...

   ÚKOL — vrať POUZE JSON s polem argumentů (max 12):
   {
     "arguments": [
       {
         "argument": "stručná formulace (max 100 znaků)",
         "smer": -1.0 až +1.0,
         "konzistence": 0.0 až 1.0,
         "cetnost": int,
         "nalady_vyskytu": [1-5]
       }
     ]
   }

   PRAVIDLA:
   - Argument = TÉMA, ne citace. 3× stejné téma = 1 argument cetnost=3.
   - Konzistence: napříč náladami 1 i 5 → vysoká (1.0). Jen v náladě 1 → 0.2.
   - Smer: AI rozhodne. „Obavy z financí" = -0.7. „Baví mě to" = +0.6.
   - Max 12 argumentů, vyber nejvýraznější.
   - Žádný terapeutický tón.
   ```
   - `temperature: 0.3`, `maxOutputTokens: 4000`, `responseMimeType: "application/json"`

3. **API endpoint** `POST /api/bwmys/[id]/arguments`
   - Načte poslední DecisionEvaluation (typ=finalni). Pokud má argumentsJson, vrátí ho. Jinak zavolá AI a uloží.
   - Volitelný query `?force=1` pro regeneraci

4. **`src/components/BwMysViz/ArgumentsGrid.tsx`** — Recharts `ScatterChart`
   - X: smer (-1 až +1), Y: konzistence (0 až 1)
   - 4 kvadranty s popisky (Tvrdé pro/proti, Náladově skreslené pro/proti)
   - Velikost bodu = cetnost
   - Body v dolních kvadrantech opacity 0.4, horní opacity 1
   - Hover tooltip: argument text + cetnost + nalady_vyskytu

5. **Integrace do BwMysDetail**:
   - V renderu `FinalEvalRender` sekce přidej **na začátek** (před A statistika) banner s `<ArgumentsGrid>` + 3 menší grafy (radar, křivka, donut)
   - Auto-fetch arguments při otevření finálního Evaluation

6. **Export do MD** (`/api/bwmys/[id]/export`):
   - Možnost A (jednodušší): vynechat z exportu, vizualizace jsou jen v UI
   - Možnost B (PDF spec): server-side render Recharts → SVG → embed jako data:URI v MD
   - Doporučuji **A pro MVP**, B jako budoucí vylepšení (Recharts SSR vyžaduje JSDOM, je to nontriviální)

---

## Soubory k úpravě / vytvoření

**Vytvořit:**
- `src/lib/bwmys-colors.ts`
- `src/components/BwMysViz/index.tsx`
- `src/components/BwMysViz/SixHatsRadar.tsx`
- `src/components/BwMysViz/MoodCurve.tsx`
- `src/components/BwMysViz/EntryTypesDonut.tsx`
- `src/components/BwMysViz/ArgumentsGrid.tsx` (commit B)
- `src/pages/api/bwmys/[id]/arguments.ts` (commit B)
- `prisma/migrations/<timestamp>_add_decision_evaluation_arguments/` (commit B)

**Upravit:**
- `prisma/schema.prisma` — `DecisionEvaluation.argumentsJson Json?`
- `src/lib/bwmys-ai.ts` — přidat `extractArguments()` funkci
- `src/components/BwMysDetail.tsx`:
  - Import `BwMysViz`
  - Přidat sekci mezi Zarámování a Časovou osu
  - V `FinalEvalRender` přidat vizualizace na začátek

**Aktualizovat docs (commit C, krátký):**
- `INSTRUKCE/03-moduly.md` — zmínit vizualizace v B&W Myš řádku
- `HANDBOOK.md` sekce „B&W Myš" — přidat odstavec o vizualizační vrstvě, přidat nový API endpoint do tabulky
- `Návody/06-pamet.html` sekce „10b. B&W Myš" — odstavec o vizuálním přehledu

---

## Důležité technické poznámky

- **Recharts ResponsiveContainer** — vždy obal grafu, jinak nefunguje na mobilu
- **Pro klasifikaci úhlů**: pokud entry má `uhelPohledu === "nevybrano"`, použij `uhelPohleduAi` pokud existuje (AI klasifikace z předchozího finalniVyhodnoceni). Tahle logika už je v `evaluate.ts`.
- **Konzistentní cesty barev**: Tailwind tinty `var(--tint-rose)` etc. už jsou globální. Pro Recharts musí být v hex/rgb formátu (Recharts neumí CSS variables). V `bwmys-colors.ts` je tedy převést na hex stringy.
- **Mood gradient na bodech v křivce**: použij `Dot` custom component v Recharts s `fill={MOOD_COLORS[entry.nalada]}`.

---

## Test po implementaci

1. Vytvoř testovací rozhodnutí v `/bwmys/nove`
2. Přidej 5+ zápisů s různými náladami a úhly
3. V detailu by měla být sekce „Vizuální přehled" rozbalená — radar + křivka + donut
4. Spusť „Finální vyhodnocení" → otevře se s vizuálním shrnutím nahoře (mřížka argumentů + 3 menší grafy) → pak text A-H
5. Mřížka argumentů: zkontrolovat že jsou body v 4 kvadrantech, hover funguje
6. Sbalit/rozbalit sekci na detailu
7. Mobilní view: grafy se skládají pod sebe (responsive)

---

## Pokud něco nesedí

- **Recharts breaking changes**: zkontroluj `node_modules/recharts/package.json` verzi a viz docs
- **Klasifikace úhlů chybí**: spusť ručně `evaluate` s typ=finalni → naplní uhelPohleduAi
- **AI prompt vrátí prázdné argumenty**: temperature možná moc nízká, zkus 0.4

---

**Pokud máš otázky před začátkem, zeptej se Petra. Jinak začni commitem A.**
