# 09 · #JeDnoDuse · denní deník

Návod, jak přidávat nové záznamy do `Jednoduse.html`. Tento dokument je primárně pro **Claude Code** — popisuje design systém, kdy jaké pozadí použít a jak střídat typografii.

---

## TL;DR

Každý den = jedna karta v `Jednoduse.html` ve formátu **Instagram square (1:1)**. Karta je jednoho ze tří typů:

| Typ | Kdy použít | HTML class |
|-----|------------|------------|
| **Foto** | Detail dne — zachycený moment | `.photo-card` |
| **Myšlenka** | Věta, otázka, pozorování | `.card.bg-XX` |
| **Báseň** | Krátké haiku, 3 řádky | `.card.bg-XX.poem` |

Texty střídej. Pozadí střídej. **Stejný den, stejný typ, stejné pozadí — chyba.**

---

## Struktura souboru

```
Jednoduse.html
├── <header.top>                    Sticky nav (neměnit)
├── <section.hero>                  Title + stats
└── <section.week>                  Týdenní sekce (1 sekce / týden)
    └── <div.grid>                  Grid karet
        ├── <div.photo-card>        Foto
        ├── <div.card.bg-XX>        Myšlenka
        └── <div.card.bg-XX.poem>   Báseň
```

Karty v gridu jsou v opačném chronologickém pořadí: **nahoře nejnovější**, dolů starší. Featured (dnešní) karta je vždy `span-2` (větší 2×2).

---

## Typografie · Space Grotesk + JetBrains Mono

Stejně jako zbytek značky. **Nikdy jiné fonty.**

| Element | Font | Weight | Velikost |
|---------|------|--------|----------|
| `.card__text` (default) | Space Grotesk | 700 Bold | `6.4cqw` |
| `.card__text.sm` | Space Grotesk | 700 Bold | `5.4cqw` |
| `.card__text.lg` | Space Grotesk | 700 Bold | `8cqw` |
| `.card__text.xl` | Space Grotesk | 700 Bold | `10.5cqw` |
| `.poem .card__text` | Space Grotesk | 600 Semibold | `6.5cqw` |
| `.card__date` | JetBrains Mono | 500 Medium | 11px / 0.2em tracking |
| `.card__tag` | JetBrains Mono | 500 Medium | 10px / 0.2em tracking |
| `.card__id` | JetBrains Mono | 500 Medium | 10px / 0.18em tracking |

> `cqw` = container query width. **5cqw = 5 % šířky karty** — tj. text škáluje s velikostí karty.

### Jak střídat velikosti

Default = `card__text` (6.4cqw). Krátký text → `lg` (8cqw, větší dopad). Dlouhý odstavec → `sm` (5.4cqw).

**Pravidlo:** věta nad 12 slov → `sm`. Pod 4 slova → `lg`. Pod 2 slova → `xl`.

### In-line zvýraznění

- `<span class="signal">slovo</span>` — důležité slovo v Signal Coral
- `<span class="em">slovo</span>` — italic regular weight (lidský dotek)

V jedné větě **max 1× signal + max 1× em**. Více = vizuální chaos.

### Lámání řádků

V básních používej `<br/>` mezi řádky — drží to rytmus básně.  
V myšlenkách **nepoužívej `<br/>`** — nech browser zalomit. Výjimka: záměrná pauza po pomlčce.

---

## 20 variant pozadí · kdy kterou

Pozadí má dvě funkce: **vizuální rytmus mezi kartami** a **emocionální barva obsahu**. Tabulka rozdělená podle "nálady".

### Klidné · tichá pozorování · základní rytmus

| # | Třída | Pozadí | Použít na |
|---|-------|--------|-----------|
| 01 | `bg-01` | Cream + spodní signal podtržení | Krátká silná věta, manifest-style |
| 06 | `bg-06` | Cream s dot grid + cream pad za textem | Pozorování, „všiml jsem si…" |
| 11 | `bg-11` | Cream + rohový signal toggle | Cokoliv kolem motivu „zapnuto" |
| 13 | `bg-13` | Cream + obří `↳` v rohu | Otázka, hledání směru |
| 14 | `bg-14` | Cream + signal rám | Citát, výrazná deklarace |
| 15 | `bg-15` | Cream + 3-pruh dole (ink/signal/teal) | Pravidlo, závěr, definice |
| 18 | `bg-18` | Cream + teal horní band | Reflexivní myšlenka |
| 19 | `bg-19` | Cream + tmavý vertikální pruh s knoflíkem | Téma „spínač" — explicitně |

### Silné · jasné, plné emoce

| # | Třída | Pozadí | Použít na |
|---|-------|--------|-----------|
| 02 | `bg-02` | Ink (plná) | Báseň / haiku, intimní moment |
| 03 | `bg-03` | Signal Coral (plná) | **Nejdůležitější věta dne** · max 2× / týden |
| 07 | `bg-07` | Ink + dot grid + rohový signal disk | Pozorování v noci, intenzita |
| 08 | `bg-08` | Cream + diagonální ink roh | Pravidlo s váhou |
| 09 | `bg-09` | Cream + signal pruh vlevo | Otázka, výzva |
| 12 | `bg-12` | Ink + concentric circles | Meditativní téma, středění pozornosti |
| 16 | `bg-16` | Ink + obří signal číslo v rohu | Datum jako téma (1., 15., 30.) |
| 20 | `bg-20` | Ink + ring + signal punch uprostřed | Báseň s jednoslovnou pointou |

### Měkké · papírové, lidské

| # | Třída | Pozadí | Použít na |
|---|-------|--------|-----------|
| 04 | `bg-04` | Teal (plná) | Báseň, klidná pravda |
| 05 | `bg-05` | Sand (plná) | Vzpomínka, dětský moment |
| 10 | `bg-10` | Sand → cream → teal 3 horizontální pásy | Třídílná struktura („ráno · poledne · večer") |
| 17 | `bg-17` | Sand + obří kurzíva „„" | **Báseň · vždy pro citát** |

---

## Pravidla střídání

### V jednom týdnu (7 dní)

- **Žádné pozadí 2× za sebou**
- **Max 2× Signal Coral (`bg-03`)** za týden — je to akcent
- **Min 1× Ink** (`bg-02` / `bg-07` / `bg-12` / `bg-16` / `bg-20`) — drží kontrast
- **Min 1× Sand nebo Teal** — měkčí varianta pro lidskost
- **3—4 cream-based** karty pro klid

### Posloupnost typů

V 7denním týdnu mám rád tento rytmus (ale není povinný):

```
po · myšlenka
út · myšlenka  
st · foto
čt · báseň
pá · myšlenka
so · foto
ne · báseň nebo myšlenka
```

Foto = 2× / týden. Báseň = 1–2× / týden. Zbytek myšlenky.

### Featured (span-2) karta

Vždy **nejnovější den** = `span-2` (2×2). Většinou foto. Pokud foto na ten den není, použij velkou myšlenku v `bg-16` (s velkým číslem) nebo `bg-03` (signal).

---

## Datum · formát

```
<span class="card__date">21. 5. · út</span>
```

- `21. 5.` — den a měsíc s tečkami, mezerou (NIKDY `21.5.`)
- `·` — středotečka (Option+Shift+9 na Mac), ne tečka ne pomlčka
- `út` — krátký název dne, lowercase

Zkratky dnů: `po · út · st · čt · pá · so · ne`

První den měsíce / start nové sekce → `1. 5. · čt · start`

---

## Tag · footer

```
<div class="card__foot">
  <span class="card__tag">↳ myšlenka</span>
  <span class="card__id">#001</span>
</div>
```

Tagy:
- `↳ myšlenka` — default
- `↳ báseň` — pro `.poem` karty
- `↳ haiku` — pro 3řádkovou báseň
- `↳ otázka` — když věta končí `?`
- `↳ pozorování` — když popisuje něco viděné
- `↳ pravidlo` / `↳ pravidlo dne` — když je to pravidlo praxe
- `↳ věta dne` — silnější vážený výrok
- `↳ manifest` — pro úvodní / definující karty
- `↳ ráno` / `↳ po session` — pro foto-cards místo „myšlenka"

ID: `#001` … `#999` — pořadové číslo karty od začátku. Inkrementálně.

---

## Šablona · nová karta

### Myšlenka

```html
<div class="card bg-09">
  <span class="card__date">22. 5. · pá</span>
  <p class="card__text">První věta. <span class="signal">Důležité slovo</span> uprostřed. Pointa.</p>
  <div class="card__foot">
    <span class="card__tag">↳ myšlenka</span>
    <span class="card__id">#022</span>
  </div>
</div>
```

### Báseň

```html
<div class="card bg-17 poem">
  <span class="card__date">23. 5. · so</span>
  <p class="card__text">první řádek<br/>druhý řádek —<br/><span class="signal">pointa</span>.</p>
  <div class="card__foot">
    <span class="card__tag">↳ báseň</span>
    <span class="card__id">#023</span>
  </div>
</div>
```

### Foto

```html
<div class="photo-card">
  <image-slot id="jd-24" placeholder="Foto · 24. 5." shape="rect"></image-slot>
  <div class="photo-card__overlay">
    <span class="photo-card__date">24. 5. · ne</span>
    <span class="photo-card__id">#024</span>
  </div>
</div>
```

**Důležité:** `id="jd-24"` musí být **unikátní** napříč celým souborem. Jinak se obrázek bude sdílet mezi kartami.

### Featured (dnešní, span-2)

```html
<div class="photo-card span-2">
  <image-slot id="jd-today" placeholder="Foto dne" shape="rect"></image-slot>
  <div class="photo-card__overlay">
    <span class="photo-card__date">25. 5. · dnes</span>
    <span class="photo-card__id">#025 · ráno</span>
  </div>
</div>
```

---

## Jazyk · tón hlasu

Stejně jako v `06-VOICE.md`:

- ✅ Krátké věty, max 12 slov
- ✅ Konkrétní obrazy (svetlo, ticho, židle, ráno)
- ✅ Otázka přebije tvrzení
- ✅ Číslo > přídavné jméno (3 vteřiny > krátká chvíle)
- ❌ Žádné motivační floskule
- ❌ Žádné emoji
- ❌ Žádné vykřičníky
- ❌ Žádné „cesty", „journey", „mindfulness"

### Ukázky správného tónu

> Tři vteřiny ticha zní jako třicet. Vydržet.

> Pátek držím v tichu. Ne protože nemám co říct.

> Když mlčím první, lidi se ozvou.

> Co tě nutí reagovat do hodiny?

### Špatně

> ❌ Dnes jsem si uvědomil, že ticho je vlastně dar.
> ❌ Začni svůj den s pozorností a uvidíš, jak se vše promění!
> ❌ Síla okamžiku je v jeho přijetí ✨

---

## Aktualizace metadat hero sekce

Po každém přidaném dni updatuj počítadla v `<section class="hero">`:

```html
<div class="hero__stat__n">21</div>
<div class="hero__stat__l">dní · květen</div>

<div class="hero__stat__n">07</div>
<div class="hero__stat__l">fotek</div>

<div class="hero__stat__n">14</div>
<div class="hero__stat__l">slov · básní</div>
```

A footer:

```html
<span>21 dní · 7 fotek · 14 myšlenek a básní</span>
```

---

## Nová týdenní sekce · šablona

Když překročí týden, přidej novou `<section class="week">`:

```html
<section class="week">
  <header class="week__head">
    <span class="week__num">↳ týden 4</span>
    <h2 class="week__title">Nadpis týdne.</h2>
    <span class="week__dates">22. — 28. 5.</span>
  </header>
  <div class="grid">
    <!-- karty -->
  </div>
</section>
```

Týden = od pondělí do neděle. Nadpis týdne = jedna krátká věta, retrospektiva („Co bylo tento týden.", „Co stálo za to.", „První dny."). **Vždy s tečkou.**

Pořadí v souboru: **nejnovější týden nahoře**, starší dolů.

---

## Když si nejsi jistý

1. Otevři `Jednoduse.html`, najdi podobný den ze správného týdne, **zkopíruj jeho strukturu**.
2. Změň pozadí na takové, které tento týden ještě nebylo.
3. Text napiš podle `06-VOICE.md`.
4. Inkrementuj ID a počítadla.
5. Otestuj — otevři stránku, podívej se, jestli text neutíká z karty.
