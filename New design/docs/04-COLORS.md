# 04 · Barvy

## Primární paleta

| Token CSS | HEX | RGB | Role |
|---|---|---|---|
| `--c-ink` | `#0E0E10` | `14 14 16` | Hlavní tmavá. Text, plné plochy. |
| `--c-cream` | `#F4EFE6` | `244 239 230` | Hlavní světlá. Pozadí, papír. |
| `--c-signal` | `#FF5C2E` | `255 92 46` | **Akcent. Spínač. Jediná „křiklavá" barva.** |

> **Pravidlo:** Signal coral je akcent, **ne výplň**. V hotové kompozici by mělo být max ~10 % plochy v Signal barvě. Pokud potřebuješ víc oranžové, použij menší plochy víckrát.

## Sekundární paleta

| Token | HEX | Role |
|---|---|---|
| `--c-teal` | `#1B4E50` | Chladný „off" protějšek. Pro téma reflexe, ticho. |
| `--c-sand` | `#EAC9A2` | Teplý papír. Pro dětské materiály, měkkost. |

Sekundárky **nikdy nesoupeří** s Signal. Pokud je v kompozici Signal, sekundárka je v menší ploše nebo jen jako akcent.

## Grayscale ramp · teplý neutrál

| Token | HEX |
|---|---|
| `--g-50` | `#F4F3F0` |
| `--g-100` | `#E6E4DE` |
| `--g-200` | `#CFCDC6` |
| `--g-300` | `#B0AEA6` |
| `--g-400` | `#8A8881` |
| `--g-500` | `#6A6862` |
| `--g-600` | `#4F4D48` |
| `--g-700` | `#383631` |
| `--g-800` | `#221F1C` |
| `--g-900` | `#0E0E10` |

> Šedá je **teplá** (biased k Ink, ne k pure neutral). Nikdy nepoužívej HSL gray 0 % saturation — vypadá to studeně a štěbnově.

---

## Použití podle kontextu

### Light theme (default)
- Background: `--c-cream`
- Text: `--c-ink`
- Akcent: `--c-signal`
- Sekundární text: `--g-600` až `--g-700`
- Hrany: `--g-200` až `--g-300`

### Dark theme
- Background: `--c-ink`
- Text: `--c-cream`
- Akcent: `--c-signal` (stejná, není potřeba měnit)
- Sekundární text: `--g-300` až `--g-400`
- Hrany: `rgba(244,239,230,.12)`

### Téma „Signal" (jen krátké plochy)
- Background: `--c-signal`
- Text: `--c-ink`
- Nikdy ne pro dlouhý čtený obsah — vždy jen jako section divider, callout, button.

### Téma „Teal" (reflexní)
- Background: `--c-teal`
- Text: `--c-cream`
- Akcent: `--c-signal` nebo `--c-sand`

### Téma „Sand" (dětský)
- Background: `--c-sand`
- Text: `--c-ink`
- Akcent: `--c-signal`

---

## Kontrast a přístupnost

Všechny kombinace v Brand Booku jsou **WCAG AA compliant** pro body text (4.5:1).

| Foreground | Background | Kontrast |
|---|---|---|
| ink na cream | ✓ 16.8:1 | AAA |
| cream na ink | ✓ 16.8:1 | AAA |
| ink na signal | ✓ 6.5:1 | AA |
| cream na teal | ✓ 8.1:1 | AAA |
| ink na sand | ✓ 12.1:1 | AAA |

**Nikdy nedávej:**
- Signal text na Cream pozadí (3.1:1 — fail pro body)
- Signal text na Sand pozadí (1.8:1 — fail i pro UI)
- Teal text na Ink pozadí (1.4:1 — fail)

---

## Sekundární palety na výběr (v `Palette Options.html`)

Brand má jako vedlejší explorace **5 alternativních párů** sekundárek. Pokud klient chce odklon od Teal + Sand:

- **A** · Teal + Sand (default)
- **B** · Plum (`#2E1B40`) + Mint (`#B8D9C0`)
- **C** · Navy (`#15244B`) + Blush (`#EFC4B0`)
- **D** · Forest (`#1F3328`) + Butter (`#F2D480`)
- **E** · Mono+ (ramp grayscale)

Primárka (Ink + Cream + Signal) **se nikdy nemění**.
