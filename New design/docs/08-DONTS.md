# 08 · Don'ts

Šest věcí, kterým se vyhnout. Detailní vizuální reference: Brand Book strana 13.

---

## 01 · Nedeformuj logo

❌ Žádné rotace, kosení, skewing, perspektiva.  
❌ Žádné natahování horizontálně nebo vertikálně.  
❌ Žádné mirror flip („Gide" + spínač + „on" jen v tomto pořadí, vždy zleva doprava).

✓ Logo používej v originální podobě ze `logos/`. Pokud potřebuješ úpravu velikosti — měň proporcionálně (`scale` jako celek).

---

## 02 · Spínač vždy ON

❌ Knob vlevo (= OFF pozice) je **chyba** v běžném použití.  
❌ Knob uprostřed (= „neutrální") je **vždy chyba**.

✓ **Jediná výjimka:** soubor `logos/wordmark/06 - Wordmark Off-state -Teal-.svg`. Tato varianta existuje jen pro kontextovou explorace v Brand Booku (téma „když průvodce není přítomný"). **Nikdy ji nepoužívej v marketingu, na webu, ve workshopech.**

---

## 03 · Žádné cizí barvy

❌ Spínač přebarvený na cokoliv jiného než Signal Coral (`#FF5C2E`).  
❌ Gradienty na logu — ani v textu, ani v toggle.  
❌ Logo na vícebarevné pozadí (fotka, vzor, gradient).

✓ Drž se palety z `docs/04-COLORS.md`. Pokud potřebuješ logo jinou barvou, použij **mono variantu** (`logos/wordmark/03 · 04 · 05`).

---

## 04 · Nepřepisuj prokládání

❌ Letter-spacing 0 nebo positive (vypadá to staticky a slabě).  
❌ Velmi široké tracking (`G I D E   O N`) — to není identita Gide-on, to je něco jiného.  
❌ Word-spacing zvětšený („Gide  on" → mezera mezi „Gide" a „on" musí být přesně výška toggle gap, ne víc).

✓ **Pevné hodnoty:**
- letter-spacing: `−0.038em`
- gap mezi „Gide" / toggle / „on": `0.12em`

---

## 05 · Žádné outline

❌ Wordmark jen jako kontura (`-webkit-text-stroke`) — značka je vždy plná.  
❌ Toggle jen jako outlined pill — je vždy vyplněný (kromě mono varianty s cutout knob).  
❌ Stroke + fill kombinace (žádné „double border" efekty).

✓ Logo je **plné**, plochá geometrie. Jediná povolená „kontura" je v mono variantě, kde je knob výřez (transparent hole).

---

## 06 · Drž kontrast

❌ Cream wordmark na Sand pozadí (kontrast cca 1.4:1).  
❌ Signal wordmark na Cream pozadí (kontrast 3.1:1).  
❌ Ink wordmark na Teal pozadí (kontrast 2.2:1).

✓ **Vždy minimálně 4.5:1** (WCAG AA pro normální text). Tabulka povolených kombinací: `docs/04-COLORS.md`.

✓ Pokud potřebuješ logo na blízkém tónu, **přidej oddělený box / kartu / outline kontejner v opačné barvě** — ne barvu loga.

---

## Bonus · obecné značkové don'ts

❌ Emoji v zákazníkovaných materiálech  
❌ Vykřičníky v headlines  
❌ Stock fotky (Unsplash, getty atd.)  
❌ AI vygenerované ilustrace  
❌ Pastelové gradienty na pozadí  
❌ „Coaching journey" rétorika  
❌ Drop shadows kromě jediného povoleného typu (plná Signal coral 30/30 px na karty)  
❌ Rounded-pill chips s textem (vizuální clutter)  
❌ Více než 1 weight v jedné větě (display Bold + body Regular je OK, ale Bold + Medium + Regular v jedné řádce ne)

---

## Co dělat, když si nejsi jistý

1. Otevři `Switch Brand Book.html` a najdi obdobnou situaci
2. Otevři `Brand Hub.html` a podívej se na příklady
3. Když nic neznajdeš → **udělej to jednodušší než si myslíš**
4. Pak ukaž autorovi značky (mediaface.cz) před vypuštěním
