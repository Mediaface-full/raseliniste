# GIDE-ON · design systém & admin

Kompletní balíček: admin rozhraní, knihovna ikon, app ikonky sub-systémů a brand dokumentace.

## Jak použít

### V prohlížeči
Otevři `Gideon Admin.html` — funguje rovnou, bez instalace. Dále:
- `Gideon Icons.html` — galerie ~150 ikon (klik = kopíruj jako SVG / JSX / název)
- `Gideon App Icons.html` — rodina app ikonek sub-systémů (se spínačem i bez)
- `Gideon Auth.html` — přihlášení / registrace / 2FA + chybové obrazovky

### V Claude Code (generování dalších materiálů)
1. Rozbal `gideon-system/` do kořene repozitáře (nebo do podsložky).
2. **`CLAUDE.md` umísti do kořene projektu** — Claude Code ho načítá automaticky na začátku každé seance. (Pokud je balíček v podsložce, buď přesuň `CLAUDE.md` do kořene, nebo přidej řádek `@gideon-system/CLAUDE.md` do kořenového `CLAUDE.md`, ať se naimportuje.)
3. Alternativně spusť v Claude Code `/init` — vygeneruje/aktualizuje kořenový `CLAUDE.md` a můžeš do něj vložit odkaz na tenhle.
4. Ověř načtení: napiš `/memory` — uvidíš, které soubory paměti Claude Code čte.
5. Pak si řekni o nové stránky, komponenty nebo materiály — Claude bude držet pravidla značky a architekturu adminu.

> CLAUDE.md čtou jak Claude Code (lokálně), tak Claude na omcreate.com. Stejná pravidla, jeden zdroj.

## Obsah

| Část | Co to je |
|---|---|
| `CLAUDE.md` | Instrukce pro Claude / Claude Code (přečti první) |
| `Gideon Admin.html` + `gideon-*.{jsx,js,css}` | Kompletní admin (React + Babel, bez buildu) |
| `Gideon Icons.html` + `icon-set.js` | ~150 line ikon, jeden zdroj pravdy |
| `Gideon App Icons.html` + `icons-gideon/` | App ikonky 8 sub-systémů (SVG + PNG) |
| `Gideon Auth.html` | Auth a chybové obrazovky |
| `brandbook.css` / `hatch-admin.css` / `gideon-admin.css` | Tokeny + komponenty |
| `docs/` | Brand dokumentace (logo, barvy, typografie, hlas, pravidla) |
| `logos/` `icons/` | SVG loga, favicony |

## Tech

Space Grotesk + JetBrains Mono (Google Fonts CDN). Plain CSS + custom properties. React jen v adminu (Babel standalone, CDN). **Žádné build tooly.**

---

`gide-on.cz` · průvodce zapnutý.
