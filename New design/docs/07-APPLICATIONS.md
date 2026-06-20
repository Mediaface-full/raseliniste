# 07 · Aplikace značky

Příklady, jak Gide-on vypadá v praxi. Pro detailní vizuál viz Brand Book strany 09–12.

---

## 1 · Workshop (dospělí)

**Téma:** trénink pro lektory, A4 obálka workshopu

- **Pozadí:** cream / ink
- **Hlavní titulek:** Space Grotesk Bold 92 px
- **Akcent:** spínač v rohu jako značkový gesture
- **Drop shadow:** plná Signal coral, offset 30/30 px
- **Wordmark:** v záhlaví malý (`data-size=xs`) — značka v pozadí, obsah napřed

Worksheet (`Worksheet.html`): 3 stránky, A4, print-ready PDF.

---

## 2 · Social (Instagram / LinkedIn)

**Formát:** čtverec 1080 × 1080 nebo příspěvek 1080 × 1350

- **Pozadí:** monochromatické (ink, cream, signal, teal)
- **Headline:** centrovaný, max 6 slov
- **Wordmark:** v rohu, `data-size=sm`
- **Žádné fotky lidí** v default šabloně — typografie a barva nesou identitu
- **Carousel:** 3–7 slidů, vždy poslední = CTA + wordmark

Příklady šablon: `Workshop Slides.html` slidy 1–5.

---

## 3 · Dětský produkt

**Téma:** stejný spínač, jinak energie

- **Pozadí:** sand (`--c-sand`) místo cream
- **Velikost titulku:** větší (kids odpouštějí scale, ne kontrast)
- **Mark:** spíš circle mark v signal než wordmark
- **Akcenty:** víc Signal coral plochy (až 20 %)
- **Žádné ilustrace zvířátek.** Symbol = spínač.
- **Jazyk:** stejně jasný jako pro dospělé. „Co tě naučí" ne „Co se naučíš"

```
Příklad: samolepka
[velký circle mark · Signal] + tagline „průvodce zapnutý."
```

---

## 4 · Byznys identita

**Vizitka:**
- 85 × 55 mm
- Front: wordmark velký (`data-size=md`) na cream pozadí
- Back: kontakty Space Grotesk Regular 9 pt + meta v JetBrains Mono 8 pt
- Žádné gradient, žádný UV lak, papír max 350g

**E-mail signature:**
- Circle mark (`08 - Circle Mark · ink` nebo `05 · signal`) 88 px
- Jméno: Space Grotesk Bold 14 px
- Role + kontakt: Space Grotesk Regular 12 px
- Separator: 1px solid `--g-200`, výška 1px

**E-mail header (newsletter):**
- Wordmark vlevo, dat-size=xs
- Šipka `↳` + eyebrow s číslem vydání vpravo

---

## 5 · Web (gide-on.cz)

**Stránky:** Domů · Workshopy · O&nbsp;mně · Kontakt

- **Light mode default**, dark mode na toggle (značka samozřejmě má svůj toggle 😉)
- **Hero:** wordmark velký (`data-size=hero`), pod ním 1 řádek tagline
- **Sekce:** vždy s eyebrow (mono) + headline (display) + 1–3 odstavce body
- **Bez stock fotek** — místo nich: typografická key visual, banner s typografií, mock-ups vlastních materiálů
- **CTA:** plný button v Ink na Cream pozadí (ne Signal — Signal je akcent, ne primary button)

Příklad funkčního prototypu: `Web Design.html`.

---

## 6 · Tisk · brand collateral

| Materiál | Specifika |
|---|---|
| Vizitka | viz výše |
| Worksheet | A4, 3 strany, ink na cream, signal akcent, mark v rohu |
| Sticker | kruh 50–80 mm, circle mark + tagline kolem |
| Razítko | square mark, 30 × 30 mm, jen ink |
| Workshop kit obálka | A4, plný Signal coral background, wordmark cream centered |
| Cedule | A2, wordmark hero size, na pozadí Ink, tagline mono dole |

---

## 7 · Motion / video

Motion knihovna v `Animations.html`.

- **Hero animace:** spínač se vlní pulsem (signal glow), knob jemně osciluje
- **Trvání:** 2.4 s loop
- **Easing:** `ease-in-out` (žádné bouncy)
- **Žádné fly-in textů** ze stran — pouze fade + scale max 1.05×
- **Žádné particles, žádné parallax**

Identita má **klid**. Pohyb je drobný, opakovaný, hypnotický.

---

## Když navrhuješ novou aplikaci

1. Začni od konce: kdo to vidí? kde? na jak dlouho?
2. Spínač je tam? Pokud ne — proč není?
3. Akcent Signal — kolik % plochy? (cíl: 5–10 %)
4. Hierarchie typo — display → headline → body → meta?
5. Pasuje to do Brand Booku jako další strana? → vizuálně ano
