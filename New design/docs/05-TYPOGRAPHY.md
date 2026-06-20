# 05 · Typografie

## Dvě rodiny

| Font | Role | Tokeny |
|---|---|---|
| **Space Grotesk** | Primární. Display + headlines + body. | `--f-sans` |
| **JetBrains Mono** | Sekundární. Eyebrow, tagy, čísla, kód. | `--f-mono` |

Obě jsou **free Google Fonts**. Žádné licence řešit nemusíš.

---

## Space Grotesk · primární

```css
font-family: 'Space Grotesk', system-ui, sans-serif;
```

**Použité řezy:** 400 Regular · 500 Medium · 700 Bold

### Hierarchie

| Role | Velikost | Weight | Tracking | Line-height | Třída |
|---|---|---|---|---|---|
| **Cover** | 260 px | 700 | −0.045em | 0.92 | `.wm[data-size=cover]` |
| **Hero** | 180 px | 700 | −0.045em | 0.92 | `.h-display`, `.wm[data-size=hero]` |
| **Display** | 96–120 px | 700 | −0.045em | 0.95 | `.h-display` |
| **Headline** | 32–54 px | 700 | −0.03em | 1.0 | `.h-title` |
| **Body** | 16–20 px | 400 | −0.005em | 1.45 | `.h-body` |
| **Caption** | 14 px | 500 | 0 | 1.4 | — |

> Pozn: **negativní tracking** je značkový. Drží to husté, sebevědomé.

---

## JetBrains Mono · sekundární

```css
font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
```

**Použitý řez:** 500 Medium · 700 Bold (vzácně)

### Použití

- **Eyebrow:** `.eyebrow` · 24 px · uppercase · letter-spacing 0.22em · vždy se šipkou `↳` před textem
- **Tagy a meta:** 11–14 px · letter-spacing 0.12em–0.18em · uppercase
- **Čísla v UI:** strany (`03 / 14`), procenta, časy
- **Kód a tokeny v dokumentaci:** inline `code`, code bloky

Mono **nikdy nepoužívej** pro body copy. Je to vyřezávací nástroj, ne textura.

---

## Pravidla sazby

### ✓ Ano

- Negativní tracking pro display (`-0.045em` až `-0.030em`)
- Maximální řádka pro body: ~64 znaků
- `text-wrap: pretty` na všech headlines
- Vícero řádků headline pomocí `<br/>` — nikoli wrap closeur
- Mixed case (Sentence case) pro headlines: „Zapnout pozornost." ne „ZAPNOUT POZORNOST"

### ✗ Ne

- Žádné ALL CAPS s pozitivním trackingem (vypadá to korpo)
- Žádné italics z primárky (Space Grotesk italic má, ale značka ho nepoužívá)
- Žádné underline pro důraz — používej weight nebo color
- Žádné dva fonty v jedné řádce (jen mixované odrážkou nebo divider)
- Žádný letter-spacing 0 pro display (zničí to sebevědomí)

---

## Interpunkce a glyfy

| Glyf | Použití | Příklad |
|---|---|---|
| `↳` | Eyebrow lead, „směřuje k…" | `↳ idea` |
| `—` | Em dash, vzdušná pauza | `Gide-on — průvodce zapnutý.` |
| `·` | Středotečka, výčet inline | `workshop · 1 den` |
| `/` | Frakce, alternativa | `12 / 14` |
| `+` / `−` | Pro/proti v mono | `+ vést, ne tlačit` |

**NIKDY:** `!` (vykřičník v marketingu), `...` (3 tečky), emoji.

---

## Český vs. anglický kontext

Značka je primárně **česká**. Headlines, body, slidy — vše česky.

- **Diakritika:** vždy plně (žádné „prukceš" hacky)
- **Uvozovky:** české („dolní – horní") ne přímé (`"…"`)
- **Pomlčka:** dlouhá em-dash (`—`), oddělená mezerami
- **Mezery:** non-breaking space (`&nbsp;`) před „a", „i", po jednoznakových předložkách („v", „k", „s", „z")

```html
<!-- ✓ Ano -->
průvodce v&nbsp;Čechách
<!-- ✗ Ne -->
průvodce v Čechách
```
