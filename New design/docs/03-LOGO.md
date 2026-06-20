# 03 · Logo · The Switch

## Koncept

Pomlčka mezi „Gide" a „on" je nahrazena **UI spínačem v poloze ON**.

```
Gide [⬤——] on    ← knob vpravo = ZAPNUTO
```

Spínač není přilepený symbol — sedí na **cap-heightu** typografie, drží její rytmus, čte se jako součást slova.

---

## Anatomie

```
font-family:    Space Grotesk Bold (700)
letter-spacing: −0.038em
toggle.height:  cap-height (= 0.72 × font-size)
toggle.width:   1.85 × toggle.height
knob:           0.72 × toggle.height (kruh)
knob.offset:    0.14 × toggle.height (od pravého kraje a horního)
```

**Tyto proporce jsou pevné.** Nikdy se nemění, ani v miniaturách, ani v print marketingu.

---

## Varianty (`logos/`)

### Wordmark · horizontální

| # | Soubor | Použití |
|---|--------|---------|
| 01 | `Wordmark Primary.svg` | Ink + Signal toggle · **primární · pro světlé pozadí** |
| 02 | `Wordmark Reverse.svg` | Cream + Signal toggle · **pro tmavé pozadí** |
| 03 | `Wordmark Mono Ink.svg` | Jednobarevné ink (knob = výřez) · pro tisk 1 barvou |
| 04 | `Wordmark Mono Cream.svg` | Jednobarevné cream · pro debossing, foil |
| 05 | `Wordmark Signal.svg` | Jednobarevné Signal Coral · expressivní použití |
| 06 | `Wordmark Off-state.svg` | Teal toggle, knob VLEVO · **koncept · jen kontextově** |

### Mark · square (`G` + spínač, sloupec)

| # | Pozadí | Použití |
|---|--------|---------|
| 01 | Ink | App ikona, favicon, razítko · **primární mark** |
| 02 | Signal | Pro tištěné materiály, samolepky |
| 03 | Cream | Pro emboss, kontextová podpis |
| 04 | Teal | Sekundární kontextová |

### Mark · circle

| # | Pozadí | Použití |
|---|--------|---------|
| 05 | Signal | Avatar, profilovka · **primární circle mark** |
| 06 | Ink | Email signature, watermark |
| 07 | Cream | Pro tištěné štítky |
| 08 | Teal | Sekundární kontextová |

---

## Minimální velikost

| Element | Web | Print |
|---|---|---|
| Wordmark | 120 px šířky | 32 mm šířky |
| Square mark | 24 px | 8 mm |
| Circle mark | 32 px | 10 mm |

Pod tyto hodnoty logo nikdy nepoužívej — knob přestane být čitelný.

---

## Ochranná zóna

Volné okolí kolem loga = **výška spínače** (`x`).

```
   ↑ x
   │
─x─[Gide ●—on]─x─
   │
   ↓ x
```

V této zóně neumísťuj jiný text, ikony, hrany layoutů.

---

## Pravidla použití

### ✓ Ano

- Wordmark na monochromatickém pozadí (cream, ink, teal, sand)
- Wordmark v záhlaví dokumentů (data-size=xs/sm)
- Square mark jako favicon a app ikona
- Circle mark jako avatar v social profilech a email signature
- Mono varianta pro 1-barevný tisk (razítka, embossing)

### ✗ Ne

- Logo nad fotografií bez odděleného boxu
- Logo s shadow, glow, gradient, outline
- Otočené, kosené, deformované
- S přepsaným letter-spacingem
- Knob vlevo (mimo „off-state" variantu)
- S přebarveným toggle (mimo definovaných variant)

Podrobně viz [08-DONTS.md](08-DONTS.md).

---

## Tagline + logo lockup

Když logo doprovází tagline:

```
[Gide ●—on]
průvodce zapnutý.
```

- Tagline pod logem, zarovnání vlevo
- Font: Space Grotesk Regular 400 nebo JetBrains Mono Medium 500
- Velikost: ~0.18× výška wordmarku
- Mezera: jedna výška spínače
