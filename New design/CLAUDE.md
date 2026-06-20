# CLAUDE.md · GIDE-ON · design systém & admin

Persistentní instrukce pro Claude Code i Claude na omcreate.com. Přečti při každé seanci.

---

## TL;DR

**gide-on** je osobní značka průvodce. Koncept = **The Switch** — pomlčka mezi „Gide" a „on" je UI spínač v poloze ON. Tento balíček obsahuje **admin rozhraní**, **knihovnu ~150 ikon**, **rodinu app ikonek sub-systémů** a **brand dokumentaci**.

Pochybnost → jednodušeji, méně barev, žádné gradienty, žádné emoji. Mezi „přidat" a „nepřidat" → nepřidávej.

---

## Co je v balíčku

```
gideon-system/
├── CLAUDE.md                  ← jsi tady
├── README.md                  ← rychlý start
│
├── Gideon Admin.html          ← KOMPLETNÍ admin · otevři první
├── Gideon Icons.html          ← galerie ~150 ikon (klik = kopíruj SVG/JSX)
├── Gideon App Icons.html      ← rodina app ikonek sub-systémů (8 appek)
├── Gideon Auth.html           ← login/registrace/2FA/zapomenuté + 404/500/údržba
│
├── brandbook.css              ← brand tokeny (barvy, písmo, spacing, .switch, .wm)
├── hatch-admin.css            ← admin tokeny + base komponenty (tabulky, tlačítka, pole)
├── gideon-admin.css           ← admin shell + moduly (kalendář, soubory, role, auth…)
│
├── icon-set.js                ← ZDROJ ~150 ikon (sdílí galerie i admin)
├── gideon-data.js             ← seed data adminu (klienti, faktury, analytika…)
├── hatch-data.js              ← data pro Hatch (kanban nápady)
│
├── gideon-ui.jsx              ← GIc ikony + UI primitiva (Switch, SegRadio, Tabs, GSelect…)
├── gideon-icons.jsx           ← přimíchá icon-set.js do GIc (nepřepisuje originály)
├── gideon-charts.jsx          ← grafy (LineChart, BarChart, Donut) · pure SVG
├── gideon-pages.jsx           ← Dashboard, Klienti, detail
├── gideon-pages2.jsx          ← Projekty, Faktury, Uživatelé, Nastavení, formulář
├── gideon-pages3.jsx          ← Analytika, Oznámení, Kalendář, Soubory
├── gideon-pages4.jsx          ← Audit log, Role & oprávnění, Newsletter, Stránky
├── gideon-components.jsx      ← knihovna komponent (galerie) + primitiva
├── gideon-app.jsx             ← app shell · nav · router
│
├── docs/                      ← brand dokumentace (philosophy, brand, logo, colors…)
├── logos/                     ← SVG loga (wordmark + mark varianty)
├── icons/                     ← favicony, app ikony
└── icons-gideon/              ← app ikonky sub-systémů (SVG + PNG 512/192/180)
```

---

## Jak spustit admin

Žádný build. Otevři `Gideon Admin.html` přímo v prohlížeči. Pořadí načítání skriptů je dané (data → icon-set → ui → icons → charts → pages → components → app) — když přidáváš nový `gideon-pagesN.jsx`, vlož `<script type="text/babel">` **před** `gideon-app.jsx`.

> React + Babel běží z CDN (unpkg, pinned verze). Pro plně offline nasazení stáhni react/react-dom/babel lokálně.

---

## Architektura adminu

- **`window.BRAND`** — admin je brand-aware. Přepíná gide-on ⇄ mediaFace (logo, e-mail doména, barvy). Nastav před `gideon-app.jsx`.
- **Scope mezi soubory** — každý `<script type="text/babel">` má vlastní scope. Komponenty se sdílí přes `Object.assign(window, {...})` na konci souboru. Při přidání komponenty ji takto exportuj.
- **Styly bez kolizí** — žádné `const styles = {}`. Pojmenuj specificky (`clientFormStyles`) nebo inline.
- **Ikony** — `<GIc.nazev />`. ~150 jmen viz `Gideon Icons.html`. Kurátorské originály ze sidebaru mají přednost před auto-importem z `icon-set.js`.

### Přidání nové stránky
1. Funkci napiš do existujícího `gideon-pagesN.jsx` (nebo nový soubor + script tag).
2. Exportuj: `Object.assign(window, { MojeStranka })`.
3. Přidej do `NAV` a `TITLES` v `gideon-app.jsx`.
4. Zapoj v routeru: `else if (page === 'klic') body = <MojeStranka />;`.

---

## Zlatá pravidla

1. **Zdroj pravdy pro tokeny = `brandbook.css` + `hatch-admin.css`.** Barvu/písmo ber přes CSS proměnnou (`var(--c-signal)`, `var(--text-2)`), nikdy hex přímo.
2. **Spínač je posvátný.** Poměr 1 : 1,85, výška = cap-height, knob vpravo. Coral `#FF5C2E` (kromě záměrných off-state variant).
3. **Signal Coral je akcent, ne výplň.** Max ~10 % plochy.
4. **Žádné emoji.** Místo nich: `↳`, `+` / `−`, glyfy z `icon-set.js`.
5. **Otázkou před tvrzením.** Headlines končí otázkou nebo tečkou, ne vykřičníkem.
6. **Logo malými:** „gide-on" v textu, „Gide-on" jen na začátku věty.

---

## Tech kontext

- **Font:** Space Grotesk (700/500/400) + JetBrains Mono (mono, čísla, eyebrow)
- **CSS:** plain CSS + custom properties, žádný framework
- **React:** jen v adminu (JSX přes Babel standalone, CDN, pinned)
- **Light + dark:** admin má obě, přepínač ukládá do `localStorage['hatch-theme']`
- **Žádné build tooly.** Vše běží otevřením HTML.

---

## Co NEdělat

- ❌ Nové barvy mimo paletu (Ink, Cream, Signal, Teal, Sand + grayscale)
- ❌ Jiné písmo než Space Grotesk + JetBrains Mono (ani Inter/Roboto/Arial jako fallback)
- ❌ Gradienty na pozadí, glow, stíny mimo Brand Book
- ❌ Emoji v UI i copy
- ❌ `const styles = {}` (kolize scope mezi Babel soubory)
- ❌ Stock fotky / AI obrázky — značka pracuje s typografií a pulsem
- ❌ Přebarvený spínač nebo coral „F"

---

## Hlas v jedné větě

> Průvodce, který je zapnutý. Jasný, konkrétní, krátký. Otázkou před tvrzením. Nikdy poučující.

---

`gide-on.cz` · průvodce zapnutý.
