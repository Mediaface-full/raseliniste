# Gide-on · Vector Logo Set v1.0

14 souborů SVG · 6 wordmark + 4 square mark + 4 circle mark.

## Struktura

```
logos/
├── wordmark/
│   ├── 01 - Wordmark Primary -light bg-.svg     ← ink + signal toggle · pro světlé pozadí
│   ├── 02 - Wordmark Reverse -dark bg-.svg      ← cream + signal toggle · pro tmavé pozadí
│   ├── 03 - Wordmark Mono Ink.svg               ← jednobarevné ink (knob = výřez)
│   ├── 04 - Wordmark Mono Cream.svg             ← jednobarevné cream (knob = výřez)
│   ├── 05 - Wordmark Signal.svg                 ← jednobarevné Signal Coral
│   └── 06 - Wordmark Off-state -Teal-.svg       ← koncept „vypnuto" (knob vlevo, teal)
└── mark/
    ├── 01 - Square Mark - ink - signal.svg      ← app ikona · primární
    ├── 02 - Square Mark - signal - ink.svg
    ├── 03 - Square Mark - cream - ink.svg
    ├── 04 - Square Mark - teal.svg
    ├── 05 - Circle Mark - signal.svg            ← avatar / razítko · primární
    ├── 06 - Circle Mark - ink.svg
    ├── 07 - Circle Mark - cream.svg
    └── 08 - Circle Mark - teal.svg
```

## Specifikace

- **Formát:** SVG (Scalable Vector Graphics)
- **Wordmark viewBox:** 1100 × 320 px
- **Mark viewBox:** 600 × 600 px (square radius 18 %, circle = plný kruh)
- **Písmo:** Space Grotesk Bold — Google Fonts (free) ·  
  https://fonts.google.com/specimen/Space+Grotesk
- **Barvy:** `#0E0E10` Ink · `#F4EFE6` Cream · `#FF5C2E` Signal Coral · `#1B4E50` Teal

## Použití v design tools

**Figma · Illustrator · Affinity:**  
Nainstaluj `Space Grotesk` lokálně (Google Fonts → Download family). Poté otevři SVG a text zůstane editovatelný. Pokud písmo nemáš, text se zobrazí v záložním písmu — v takovém případě v aplikaci převeď text na křivky (*Type → Create Outlines*) z dodaného PDF.

**Web:**  
SVG má embedded `@import` z Google Fonts — funguje přímo v prohlížeči, žádné další kroky nejsou potřeba.

**Tisk:**  
Otevři příslušné SVG v Illustratoru → *Type → Create Outlines* → exportuj jako PDF/X-1a. Nebo použij PDF verzi z balíčku.

## Minimální velikost

- Wordmark: **120 px** / **32 mm** šířky
- Square mark: **24 px** / **8 mm**
- Circle mark: **32 px** / **10 mm**

## Clear space

Volné okolí kolem loga = **výška toggle** (≈ výška písmene „o" ve wordmarku).
Nikdy menší.

## Don'ts

- ❌ Nepřebarvuj toggle — Signal Coral je pevně daný
- ❌ Neměň poměr toggle pillu (1 : 1.85)
- ❌ Neotáčej knob doleva mimo „off-state" variantu
- ❌ Nestáčej, nezakřivuj, neaplikuj efekty (stín, glow, gradient)
- ❌ Neumísťuj na pozadí s nízkým kontrastem
- ❌ Neoddělej toggle od slov „Gide" a „on"

Podrobně v Brand Booku → strana „Don'ts" a „Anatomie".
