# B&W Myš — metriky a metody rozhodování

Dokument vysvětluje **co rozhodovací linka v Rašeliništi reálně používá** — jaké modely, jaké metriky, jaké rámce, jaké výstupy. Stav 2026-05-06 (+ Decision Compass).

URL modulu: **`/bwmys`**

---

## 1. Filozofie (proč to vzniklo)

Klasické rozhodování v jeden moment je past pro **emocionální rozhodovací styl** (CPTSD, ADHD). Současná nálada přebije všechno a 14 dní starý argument zmizí.

B&W Myš je **longitudinální linka**: 14 dní (default) sběr vstupů, AI klasifikuje a agreguje, nakonec dá strukturovaný verdikt **s odůvodněním** — ne za uživatele, ale jako protějšek pro argumentaci.

**Tón všech AI výstupů:** věcný, argumentační, strukturovaný.
- ❌ NE: „vidím že tě to trápí", „rozumím tvé situaci"
- ✅ ANO: „Z 8 zápisů 6 obsahuje rizika finanční. Hlavní opakující se motiv: …"

Emoce zpracujeme **jako data**, ne jako téma. Žádný terapeutický jazyk.

---

## 2. Datový model

### Decision (rozhodnutí)
| Pole | Typ | Význam |
|---|---|---|
| `nazev` | string | Pracovní název pro orientaci v archivu |
| `kontext` | enum | `pracovni` \| `osobni` \| `smiseny` (řídí jaká kritéria se použijí v sekci G) |
| `otazka` | text | Formulovaná jako **otázka** („Mám vzít tu zakázku?") |
| `varianty` | string[] | **Minimum 3** — pokud uživatel zadal jen 2, AI navrhne další |
| `predpoklady` | string[] | Minimum 1, věci které předpokládám že platí |
| `deadlineRozhodnuti` | datetime | Kdy se musí rozhodnout |
| `delkaSberuDny` | int | Default **14** |
| `status` | enum | `aktivni` \| `uzavrene_jdu` \| `uzavrene_nejdu` \| `odlozene` \| `archivovane` |
| `autorstvi` | enum | `pro_me` \| `pro_jineho` \| `spolecne` \| `nejsem_si_jisty` (Doplněk 2) |
| `autorstviKdo` | string? | Pro koho dalšího (u pro_jineho/spolecne) |
| `verdiktText` | text? | Po finálním vyhodnocení |
| `coByZmeniloVerdikt` | text? | „Co by ho překlopilo" — konkrétní fakt, NE emoce |

### DecisionEntry (jeden zápis)
| Pole | Typ | Význam |
|---|---|---|
| `datum` | datetime | Kdy zapsáno |
| `nalada` | int 1-5 | **Klíčová metrika** — používá se pro detekci „náladově zkreslené" argumenty |
| `typVstupu` | enum | `novy_fakt_zvenci` \| `nova_uvaha` \| `napadlo_me` \| `reakce_na_udalost` |
| `uhelPohledu` | enum | Six Hats: `fakta` \| `emoce` \| `kritika` \| `prinosy` \| `alternativy` \| `meta` \| `nevybrano` |
| `stavSystemu` | enum | `aktivovany` \| `stazeny` \| `klidny` \| `nevim` (Doplněk 2 — stav nervového systému) |
| `obsah` | text | Vlastní zápis (hlasově nebo textově) |
| `uhelPohleduAi` | string? | Pokud `uhelPohledu = nevybrano`, AI doplní při finálním vyhodnocení |
| `audioPath/Mime/Bytes` | | Pokud Entry vznikl z audio záznamu (Stage 1 přepis + Stage 2 metadata) |

### DecisionEvaluation (AI vyhodnocení)
| Pole | Význam |
|---|---|
| `typ` | `prubezne` (mini-tick každý den 7:10) \| `finalni` (jednorázové) |
| `obsahStrukturovany` | Celý JSON výstup (pro finální = sekce A-H) |
| `argumentsJson` | Mřížka argumentů (jen pro finální, generuje se zvlášť) |
| `pocetVstupuVDobeGenerovani` | Pro audit |
| `modelName/promptTokens/outputTokens` | AI usage tracking |

### DecisionReopening (Doplněk 2 — Tok 5)
Pokud uživatel chce po finálním verdiktu znovu otevřít, musí explicitně potvrdit **„toto je opravdu nový fakt"** (`schvaleno=true`). Bez toho znovuotevření = ne. Cílem je zabránit tomu, aby emoce přepsala argumentovaný verdikt.

---

## 3. Metoda — Six Thinking Hats (de Bono)

Každý zápis se klasifikuje do jedné ze 6 kategorií:

| Klobouk | Co to znamená |
|---|---|
| 🤍 **Bílý — fakta** | Věcné informace, čísla, pozorování |
| ❤️ **Červený — emoce** | Pocity, intuice, nálada |
| 🖤 **Černý — kritika** | Rizika, problémy, „co může selhat" |
| 💛 **Žlutý — přínosy** | Pozitiva, výhody |
| 💚 **Zelený — alternativy** | Kreativní nápady, jiné cesty |
| 💙 **Modrý — meta** | Pozorování o procesu rozhodování samotném |

Klobouky se používají **dvakrát**:
1. Při zápisu — uživatel sám přiřadí (nebo nechá AI klasifikovat přes `klasifikujUhly()` při finálním vyhodnocení)
2. Ve finálním verdiktu — sekce **B_sixHats** agreguje 2-4 odrážek per klobouk

---

## 4. AI funkce (lib `bwmys-ai.ts`)

Všechny volání jdou přes **Gemini 2.5 Pro** (`ANALYSIS_MODEL`), tracked přes `callTracked` do `AiUsageLog`.

### 4.1 `navrhniDalsiVarianty(otazka, soucasneVarianty)`
**Kdy:** uživatel zadal v formuláři jen 2 varianty.
**Co dělá:** AI navrhne 2-3 další realistické varianty, **co se typicky míjí** — menší verze, odložení, delegování, ne-akce, hybridní řešení.
**Temperature:** 0.5 (mírně kreativní).

### 4.2 `miniVyhodnoceni(decision, entries)` — Tok 3
**Kdy:** každý den 7:10 (cron `bwmys-tick`) přes všechna otevřená rozhodnutí. Také ručně přes endpoint.
**Cíl:** ZRCADLO, ne rozhodnutí. Jen ukázat zatím viditelné vzorce.
**Výstup:**
```
{
  rozlozeniNalad: "Z 6 zápisů: 4× nálada 4-5, 2× nálada 1-2",
  opakujiciSeMotivy: ["motiv 1", "motiv 2", "motiv 3"],
  chybejiciUhly: ["fakta", "finanční pohled"],
  poznamka: "1-2 věty co stojí za pozornost. Bez doporučení."
}
```
**Temperature:** 0.3.

### 4.3 `finalniVyhodnoceni(decision, entries)` — Tok 4 (sekce A-H)

**Hlavní rozhodovací výstup.** 8 sekcí:

#### A. Statistika
Audit kvality vzorku.
- `pocetZapisu`
- `rozsahDni`
- `distribuceNalad` — např. „1: 0×, 2: 1×, 3: 4×, 4: 2×, 5: 1×"
- `distribuceTypu` — typVstupu rozloženo
- `upozorneni` — pokud je vzorek slabý/nevyvážený (např. všechny zápisy v náladě 1, nebo jen 2 zápisy za 14 dní)

#### B. Six Hats — agregace
6 polí (fakta / emoce / kritika / přínosy / alternativy / meta), každé 2-4 odrážky napříč všemi zápisy.

#### C. Signál a šum (Signal Sum)
- `konzistentniSignaly` — co se opakuje **napříč náladami** (vysoká konzistence = silný argument)
- `naladoveSkrelene` — co je řečeno **jen v určité náladě** (často strach v náladě 1, euforie v náladě 5)
- `recyklovaneUvahy` — co se točí dokola **bez nových informací**

#### D. Pre-Mortem (Klein, Kahneman)
„Je rok X+1, rozhodnutí selhalo. Proč?"
- `horizont` — narativ
- `duvody` — 5 nejpravděpodobnějších důvodů selhání

#### E. Horizont 10/10/10 (Suzy Welch)
- `za10Minut` — jak se cítím za 10 minut po rozhodnutí
- `za10Mesicu` — za 10 měsíců
- `za10Let` — za 10 let

Slouží proti present bias (přeceňování bezprostředního).

#### F. Wrap Check (Heath bros — Decisive)
- `realneViceVariant` — opravdu jsem zvážil víc než 2?
- `otestovanePredpoklady` — testoval jsem to o čem si myslím že vím?
- `dostatecnyOdstup` — neudělal jsem to v afektu?
- `planB` — co když to nevyjde?

#### G. Doménová kritéria — podle `kontext`

**Pracovní kontext:**
- `obchodni` — obchodní dopad
- `financni` — finanční náklady/přínosy
- `marketingovy` — pozice na trhu
- `narocnostRealizace` — kolik to stojí v energii a čase
- `strategickyFit` — sedí to do dlouhodobé strategie?

**Osobní kontext:**
- `souladSHodnotami` — sedí to s tím, co je pro mě důležité?
- `vlivNaVztahy` — co to udělá s vztahy?
- `vlivNaCasAEnergii` — kolik mě to bude stát osobně?
- `reverzibilita` — jde to vrátit pokud nezafunguje?
- `souladSeZivotniFazi` — sedí to do toho, kde teď v životě jsem?

**Smíšený kontext:** vyplní oba bloky.

#### H. Verdikt
- `doporuceni` — konkrétní doporučení s odůvodněním (1-2 věty)
- `hlavniArgumentPro` — top argument pro
- `hlavniArgumentProti` — top argument proti
- `coByPreklopilo` — **konkrétní nový fakt** který by změnil verdikt (NE emoce)
- `doporuceneDatumRevize` — typicky 3-12 měsíců po deadlinu

**Temperature:** 0.2 (chceme předvídatelnost). MaxTokens: 16k.

### 4.4 `extractArguments(decision, entries)` — pro vizualizaci
**Kdy:** generuje se zvlášť po finálním vyhodnocení (cache do `argumentsJson`, regenerace přes `?force=1`).
**Co vrací:** pole **až 12 argumentů** s metrikami:

| Pole | Rozsah | Co znamená |
|---|---|---|
| `argument` | string max 100 znaků | Stručné téma (NE citace) |
| `smer` | -1.0 až +1.0 | -1 = silně proti, 0 = neutrální, +1 = silně pro |
| `konzistence` | 0.0 až 1.0 | Stejně silně napříč náladami → vysoká. Jen v náladě 1 → 0.2 |
| `cetnost` | int | Kolikrát se objevil v zápisech (3× stejné téma = 1 argument cetnost=3) |
| `nalady_vyskytu` | int[] 1-5 | V kterých náladách se objevil |

Tyhle metriky napájí **mřížku argumentů** (ScatterChart smer × konzistence, velikost dle cetnost).

### 4.5 `klasifikujUhly(obsahy)`
**Kdy:** subprocess uvnitř `finalniVyhodnoceni`, jen pro entries s `uhelPohledu="nevybrano"`.
**Co dělá:** klasifikuje obsah do jedné ze 6 Six Hats kategorií.
**Temperature:** 0.1 (deterministic).

### 4.6 Klobouk (Six Hats) v argumentech
Od **2026-05-06** (Decision Compass spec) `extractArguments()` vrací navíc pole `klobouk` per argument:
```
klobouk: "fakta" | "emoce" | "kritika" | "prinosy" | "alternativy" | "meta"
```
AI klasifikuje podle převažujícího charakteru obsahu. Příklady:
- „vysoké náklady" → kritika
- „cítil bych se dobře" → emoce
- „data ukazují růst trhu" → fakta
- „nový kanál distribuce" → prinosy
- „mohli bychom udělat menší verzi" → alternativy
- „uvědomuji si že rozhoduji unaveně" → meta

Optional v Zod — legacy argumentsJson bez `klobouk` jsou platné, fallback v UI = `meta` (šedá).

---

## 5. Vizualizace (`src/components/BwMysViz/`)

| Komponenta | Co ukazuje | Knihovna |
|---|---|---|
| **DecisionCompass** *(NOVÉ 2026-05-06)* | **Primární shrnutí** — SVG kompas se 4 kvadranty (silný signál PRO/PROTI nahoře, šum strach/euforie dole), v centru verdikt + „opřený o sever/východ/jih/západ" | custom SVG |
| **SixHatsRadar** | 6-hatový radar — kolik zápisů v každé kategorii | Recharts RadarChart |
| **MoodCurve** | Křivka nálad v čase + tooltip s textem zápisu | Recharts LineChart |
| **EntryTypesDonut** | Donut rozložení `typVstupu` | Recharts PieChart |
| **ArgumentsGrid** | ScatterChart `smer × konzistence`, velikost = `cetnost`, drill-down detail | Recharts ScatterChart |

Pořadí v UI: **DecisionCompass je první** (primární „kde rozhodnutí stojí"), ostatní jsou drill-down detaily.

Sdílené barvy v `src/lib/bwmys-colors.ts`:
- `HAT_COLORS` (s klíči `bily`/`cerveny`/...) pro SixHatsRadar a interní mapping
- `COMPASS_HAT_COLORS` (s klíči `fakta`/`emoce`/...) — sytější varianty pro fill bodu na světlém SVG (Decision Compass spec)

### DecisionCompass — mapování dat na souřadnice

ViewBox `0 0 680 600`. Argumenty se mapují:

| Atribut | Mapování | Rozsah |
|---|---|---|
| Pozice X | `340 + smer * 300` | 40 (proti) až 640 (pro) |
| Pozice Y | `300 + (0.5 - konzistence) * 480` | 60 (signál nahoře) až 540 (šum dole) |
| Velikost (r) | `min(32, 10 + cetnost * 2)` | 12 (1×) až 32 (12×+) |
| Fill | `COMPASS_HAT_COLORS[klobouk]` | per Six Hats |
| Opacity | `konz > 0.5 ? 0.85 : 0.50` | signal/šum |
| Stroke | `konz > 0.5 ? solid : dashed (2 2)` | signal/šum |
| Group opacity | `konz > 0.5 ? 1.0 : 0.55` | signal/šum |

**4 kvadranty:**
- **SZ** (smer<0, konz>0.5) — silný signál PROTI (konzistentní napříč náladami)
- **SV** (smer>0, konz>0.5) — silný signál PRO
- **JZ** (smer<0, konz<0.5) — šum strach (jen v náladě 1–2)
- **JV** (smer>0, konz<0.5) — šum euforie (jen v náladě 4–5)

**Centrum kompasu** — verdikt:
| `decision.status` | Text | Barva |
|---|---|---|
| `aktivni` | „verdikt: čeká" | terakota `#A0522D` |
| `uzavrene_jdu` | „verdikt: jdu" | zelená `#0F6E56` |
| `uzavrene_nejdu` | „verdikt: nejdu" | růžová `#993556` |
| `odlozene` | „verdikt: odložit" | amber `#854F0B` |
| `archivovane` | „verdikt: archiv" | šedá `#5C5650` |

**Subtext „opřený o ..."** — kvadrant s nejvyšší váhou. Váha = `Σ cetnost × |smer|` napříč signál argumenty (konz > 0.5). Pokud max < 5 → „slabý signál".

Spec: [`zadani-decision-compass.pdf`](/Users/petrperina/Downloads/zadani-decision-compass.pdf) (květen 2026).

---

## 6. Tok rozhodování (Toky 1-5)

```
TOK 1 — Vytvoření rozhodnutí
  formulář: nazev, kontext, otazka, varianty (≥3, AI navrhuje), predpoklady,
            deadline, delkaSberuDny, autorstvi
  ↓
TOK 2 — Sběr (default 14 dní)
  uživatel přidává entries (text/audio):
    nalada 1-5, typVstupu, uhelPohledu (nebo nevybrano), stavSystemu, obsah
  ↓
TOK 3 — Mini-tick (cron 7:10 + manuální)
  miniVyhodnoceni() — zrcadlo, ne rozhodnutí
  ↓
TOK 4 — Finální vyhodnocení (po deadlinu nebo manuálně)
  finalniVyhodnoceni() → sekce A-H
  extractArguments() → mřížka argumentů
  Verdict: status = "uzavrene_jdu" | "uzavrene_nejdu" | "odlozene"
  ↓
TOK 5 — Reopening (Doplněk 2)
  uživatel chce uzavřít/změnit verdikt
  KDYŽ poslední zápis byl v stavSystemu="aktivovany" nebo "stazeny":
    → systém nabídne odložení o 48 h (nesmí rozhodovat v afektu)
  PŘI reopen: vyžadovat "popisNovehoFaktu" + schvaleno=true
```

---

## 7. Modely a frameworky které B&W Myš používá

| Framework | Autor | Kde se v B&W Myš objevuje |
|---|---|---|
| **Six Thinking Hats** | Edward de Bono | Klasifikace zápisů + sekce B finálního vyhodnocení |
| **Pre-Mortem** | Gary Klein, Daniel Kahneman | Sekce D — „Je rok X+1, rozhodnutí selhalo" |
| **10/10/10** | Suzy Welch | Sekce E — horizont 10 minut / 10 měsíců / 10 let |
| **WRAP framework** | Chip & Dan Heath (Decisive) | Sekce F — Widen options / Reality test / Attain distance / Prepare for failure |
| **Polyvagal-inspired stav systému** | Stephen Porges (volně) | `stavSystemu` (aktivovaný/stažený/klidný) — Doplněk 2, blokuje uzávěr v afektu |
| **Reverzibilita** | Bezos „one-way / two-way doors" | Kritérium v sekci G.osobni (reverzibilita) |
| **Hodnotové ukotvení** | různí (Acceptance & Commitment Therapy) | Kritérium G.osobni (souladSHodnotami) |
| **Argumenty: směr × konzistence × četnost** | vlastní syntéza | Mřížka v `extractArguments()` — argumenty napříč náladami silnější než ty náladově zkreslené |

---

## 8. Co B&W Myš **vědomě nedělá**

- **Nerozhoduje za uživatele.** AI dává verdikt s odůvodněním, ale uživatel klikne ručně „jdu / nejdu / odložit".
- **Žádný terapeutický jazyk.** Emoce = data, ne téma.
- **Žádný streak / gamifikace.** Když 3 dny nezapíšu, stane se nic.
- **Žádné aliasy „správných odpovědí".** AI nepoužívá floskule typu „rozhodnutí by mělo respektovat tvé hodnoty" — to je obecná pravda která nepomáhá.
- **Žádné multi-user pro sdílená rozhodnutí.** Single-user z designu (i u `autorstvi=spolecne` zapisuje jen Petr).

---

## 9. Rychlá orientace v kódu

| Soubor | Co tam je |
|---|---|
| `src/lib/bwmys-ai.ts` | 4 AI funkce + typy (DecisionForAi, EntryForAi, FinalniEvaluation, DecisionArgument) |
| `src/lib/bwmys-colors.ts` | Sdílené barvy pro Six Hats vizualizace |
| `src/components/BwMysViz/index.tsx` | Sjednocená vizualizační vrstva |
| `src/pages/api/bwmys/[id]/arguments.ts` | Cache + regenerace mřížky argumentů |
| `src/pages/api/cron/bwmys-tick.ts` | Denní 7:10 mini-vyhodnocení |
| `prisma/schema.prisma:1255+` | `Decision`, `DecisionEntry`, `DecisionEvaluation`, `DecisionReopening` |

---

*Dokument udržuj synchronně s kódem. Při přidání nového kritéria / metody / Six Hats sekce sem doplň.*
