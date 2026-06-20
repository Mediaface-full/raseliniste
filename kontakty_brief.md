# Project Brief — Editor a synchronizace kontaktů (iCloud + Google Workspace)

Dokument je **technology-agnostic** souhrn produktu a funkčních požadavků.
Použij ho jako zadání v nové AI session — vyber si vlastní stack (frontend,
backend, deployment), ale funkční vlastnosti a business pravidla by měly
zůstat zachovány.

---

## 1. Účel produktu

Nativní rozhraní Apple Contacts neumožňuje pohodlnou hromadnou editaci
kontaktů (jeden záznam = ~3 obrazovky). Cílem je **lokální webová aplikace**,
která zobrazí kontakty z iCloudu jako editovatelnou tabulku a umožní:

- rychlou hromadnou editaci, vyhledávání, filtrování
- bezpečné mazání a zakládání kontaktů
- detekci a slučování duplicit
- normalizaci dat (telefony, datumy)
- import/export kontaktů (VCF i CSV)
- jednosměrnou synchronizaci do Google Workspace **bez vytváření duplicit**
- detekci kontaktů přidaných z mobilu/jiného zařízení v terénu

**iCloud zůstává zdrojem pravdy.** Google je zrcadlový cíl, žádné dvoucestné
sloučení.

---

## 2. Cílový uživatel

Jeden uživatel (osobní/firemní použití), provoz v lokální síti (LAN) nebo
na vlastním NAS. Žádné víceuživatelské scénáře. PIN brána je dostatečná
ochrana proti náhodnému kolemjdoucímu.

---

## 3. Datový model — kontakt

Pole, která aplikace zobrazuje a edituje:

| Pole | Typ | Poznámka |
|---|---|---|
| UID | string | Stabilní identifikátor pro párování napříč systémy |
| Jméno (first name) | string | |
| Příjmení (last name) | string | |
| Firma (org) | string | |
| Skupiny | seznam stringů | Apple skupiny (viz sekce 7) |
| Telefon — mobil | string | Volný formát |
| Telefon — práce | string | |
| Druhý telefon | string | Třetí slot pro libovolný další telefon |
| E-mail primární | string | Typicky pracovní |
| E-mail soukromý | string | |
| Narozeniny | string `YYYY-MM-DD` | Při ukládání se normalizuje |
| Adresa | text | Free-form, podporuje víceřádkové |
| Poznámka | text | Free-form |

Formát úložiště na serveru: **vCard 3.0** (kompatibilní s iCloud i Google).

---

## 4. Datový model — skupina

Skupina v Apple ekosystému není pole na kontaktu, je to samostatný záznam.
Aplikace to skrývá — uživatel vidí sloupec „Skupiny" jako čárkou oddělené
názvy. Při uložení aplikace vypočítá diff (přidat/odebrat členy) a updatuje
příslušné skupinové záznamy na serveru.

| Pole | Typ |
|---|---|
| UID | string |
| Název | string |
| Seznam členů | množina UID kontaktů |

---

## 5. UI — kompletní rozpis obrazovek a komponent

### 5.1 PIN brána (vstup do aplikace)

- Při prvním spuštění uživatel **nastaví PIN** (4–10 znaků), potvrdí ho
- PIN se ukládá zahashovaný (SHA-256 + salt), nikdy v plaintextu
- Při dalším otevření aplikace vyzve k zadání
- **Auto-zámek po N minutách nečinnosti** (default 30, konfigurovatelné
  přes ENV proměnnou)
- Tlačítko **„Zamknout"** pro okamžitý manuální zámek
- Po 5 neúspěšných pokusech blokáda do restartu
- Reset PINu: smazat persistentní soubor s hashem (instrukce v UI)

### 5.2 Hero hlavička

Souhrnný panel nahoře. Obsahuje:
- Název aplikace + ikona
- **Live statistiky**: `N kontaktů · M neuložených změn · časy posledních
  synchronizací (download/upload iCloud, sync Google)`
- Časy v relativní formě (`před 5 min`, `před 2 h`) pokud < 24 h, jinak
  absolutní (`26.4. 10:23`)

### 5.3 Sidebar (boční panel, vlevo)

Defaultně zavřený, otevírá se šipkou. Obsahuje:
- Vstupní pole **Apple ID + App password** (auto-předvyplněné z env)
- 🔌 **Tlačítko „Připojit / obnovit"** — naváže CardDAV spojení
- **Status pill** s tečkou: 🟢 Synchronizováno / 🟠 Neuložené změny: N /
  🔴 Nepřipojeno
- 🔄 **„Synchronizovat s iCloudem"** — znovu stáhne data ze serveru
- 🔁 **„Aktualizace Google"** — propíše všechny iCloud kontakty do Googlu
- 🧹 **„Vyčistit duplicity v Google"** — najde a smaže existující duplicity
- 🔒 **„Zamknout"** — manuální zámek (vyžádá PIN)
- Info o cestě k lokální záloze

### 5.4 Banner „Nově přidané kontakty"

Pokud aplikace detekuje UID, které nikdy předtím neviděla (kontakt byl
přidán v terénu z mobilu nebo v jiné aplikaci), zobrazí se nahoře nad
gridem výrazný banner:

> 🆕 **N nově přidaných kontaktů** od minulé synchronizace.
> [👁 Zobrazit jen tyto] [✓ Označit jako prohlédnuté]

- **Zobrazit jen tyto** → zafiltruje grid jen na nové
- **Označit jako prohlédnuté** → uloží aktuální seznam UID jako baseline,
  banner zmizí

Implementace: aplikace si lokálně drží set UID, které už viděla. Diff
oproti aktuálnímu stavu = noví.

### 5.5 Toolbar (nad tabulkou)

Vodorovná lišta:
- 🔍 **Vyhledávací pole** — fulltext přes všechny sloupce
- **Velikost stránky** dropdown: 10 / 25 / 50 / 100
- 💾 **„Uložit (iCloud)"** — pošle všechny dirty kontakty jen na iCloud
- 💾🔁 **„Uložit + Google"** (primární, výrazné) — uloží do iCloudu a hned
  propíše vše do Googlu
- ➕ **„Nový kontakt"** — založí prázdný řádek
- ➕ **„Nová skupina"** — modální dialog s názvem

### 5.6 Hlavní tabulka

**Akční sloupce vlevo (pinned, řazení vypnuté):**

| Sloupec | Typ | Akce |
|---|---|---|
| 🗑 Smazat | checkbox | Otevře potvrzovací panel nad tabulkou |
| ✓ Vybrat | checkbox | Pro hromadné akce (Smazat vybrané, Přidat do skupiny) |
| 📤 Odeslat | checkbox | Okamžitě pošle ten jeden kontakt na server; po úspěchu zůstane zaškrtnutý jako indikátor „posláno" |

**Datové sloupce (single-click editace):**
Jméno, Příjmení, Firma, Skupiny, Mobil, Práce, Druhý telefon, E-mail,
Soukromý e-mail, Narozeniny, Adresa, Poznámka.

- **Single-click** vstoupí do edit modu (žádný double-click)
- Enter potvrdí a skočí o řádek dolů
- Adresa a Poznámka mají popup large-text editor (vícřádkový)
- Default sort: Příjmení → Jméno → Firma (case-insensitive)
- Stránkování pod tabulkou (předchozí/další + počet stránek)

**Indikace dirty stavu**: jakákoli změna buňky označí řádek jako neuložený.
Sidebar status pill se přepne na 🟠, hero podtitulek aktualizuje počet.

**Hromadné akce nad tabulkou** (objevují se podle stavu):
- Pokud někdo zaškrtl Smazat → potvrzovací panel **nad** tabulkou
  s tlačítky [✅ Ano, smazat] [✖ Zrušit] + seznam názvů
- Pokud je něco zaškrtnuto ve Vybrat → tlačítka **[🗑 Smazat vybrané]**
  a **[📁 Přidat do skupiny]** se objeví pod tabulkou

### 5.7 Chip seznam skupin (nad gridem)

Všechny existující skupiny jako akcent-barevné „kapsle" s počtem členů
(např. `Rodina 5`). Slouží jako vizuální našeptávač — uživatel ví, co
přesně napsat do sloupce Skupiny, aby se neudělala duplicitní skupina
s jiným zápisem (např. `rodina` vs `Rodina`).

**Case-insensitive normalizace při uložení**: pokud uživatel napíše
`rodina` a existuje `Rodina`, aplikace tiše dorovná na `Rodina`. Žádné
duplicity skupin.

### 5.8 Sekce „Nástroje" (rozbalovací)

Pod gridem, sedm záložek:

#### A) Validace
Tlačítka s počty pro různé „neúplnosti":
- bez telefonu / bez e-mailu / bez skupiny / bez firmy / s neúplným jménem /
  bez jakýchkoli kontaktních údajů

Klik na tlačítko **zafiltruje grid** jen na tu kategorii. Aktivní filtr má
banner s [✖ Zrušit filtr].

#### B) Duplicity v iCloudu
- Tlačítko **„Najít duplicity"** prochází clustery podle:
  - shody jména (case-insensitive)
  - shody telefonu (posledních 9 číslic, robustní napříč formátováním)
  - shody e-mailu (lowercase)
- U každého clusteru uživatel vybere **primární kontakt (vítěz)**
- Tlačítko **„Sloučit a smazat ostatní"**:
  - primární se obohatí o pole z ostatních (chybějící hodnoty se doplní,
    telefony do volných slotů, skupiny union)
  - primární se uloží, ostatní se smažou
  - vše se zazálohuje

#### C) Find & Replace
- Hromadná textová náhrada ve vybraném sloupci
- Volby: **regex**, **case-sensitive**
- Působí nad **aktuálně filtrovanými** kontakty (search + validační filtr)
- Tlačítko „Náhled" ukáže prvních 20 změn před aplikací
- Po Apply jsou řádky dirty → musí ještě Uložit & Sync

#### D) Telefony +420 (normalizace na CZ formát)
- Hledá kandidáty pro normalizaci na `+420 XXX XXX XXX`
- **Pravidla**:
  - Čísla začínající `+` nebo `00` se **vždy přeskočí** (mezinárodní)
  - Jen 9místná domácí čísla jsou kandidáty
  - 🟢 **CZ likely** (matchuje CZ rozsahy 60[1-8], 72-77x, 79x mobile;
    2-5xx landline) → defaultně zaškrtnuté
  - 🟡 **ambiguous** (může být SK 9xx nebo neznámé) → defaultně **odznačené**
- Náhled jednotlivých změn s checkboxy, uživatel může ručně přepínat
- Po Apply se řádky označí dirty

#### E) Import VCF/CSV
- Drag & drop souboru
- Parser rozpozná `.vcf` nebo `.csv` (sniffuje oddělovač u CSV)
- Mapuje CSV hlavičky česky i anglicky (`First Name`/`Jméno`, `Mobile`/`Mobil`...)
- Detekuje kolize s existujícími kontakty (jméno, telefon, e-mail)
- Defaultně přeskočí duplicity, uživatel může ručně zapnout přepsání
- Po Apply pošle PUTem nové kontakty na server

#### F) Obnova ze zálohy (Undo)
- Listuje posledních 80 záloh ze souborového úložiště
- Dva typy:
  - `before_delete` → tlačítko obnoví smazaný kontakt jako nový
  - `before_put` → tlačítko vrátí předchozí verzi (přes UID match);
    pokud kontakt už neexistuje, založí ho jako nový

#### G) Google Workspace
- 🔌 **Test připojení** — ověří CardDAV credentials, ukáže počet kontaktů
- 🔍 **Porovnat (iCloud ↔ Google)** — tři dlaždice:
  - Společné (UID match)
  - Jen v iCloudu (push by je přidal)
  - Jen v Googlu (pull-back kandidáti)
- 📥 **„Stáhnout extras z Googlu do iCloudu"** — obrácený směr, kontakty
  které jsi vytvořil přímo v Googlu se propíšou do iCloudu
- 🚀 **„Synchronizovat do Google"** se scope dropdownem:
  - Všichni iCloud kontakty
  - Firma: konkrétní (dynamicky podle existujících firem)
  - Skupina: konkrétní (dynamicky podle existujících skupin)
  - Pouze nově přidané (mobil) — kontakty v session_state.new_uids
- 🧹 **„Najít duplicity v Google"** — union-find detekce + interaktivní
  potvrzení smazání

### 5.9 Export kontaktů (rozbalovací sekce)

- **Scope dropdown**: Všichni / Firma: X / Skupina: Y
- **Formát**: VCF (univerzální) nebo CSV (středník, UTF-8 BOM, Excel-friendly)
- **Checkbox „🏢 Firemní export (jen základní pole)"**:
  - Vyexportuje POUZE: Jméno, Příjmení, Firma, Telefon, Druhý telefon,
    Narozeniny, E-mail
  - Telefon = preferenčně mobil → fallback práce → fallback ostatní
  - Druhý telefon = další ne-prázdný v pořadí
  - E-mail = preferenčně primární → fallback soukromý
- Tlačítko **„Stáhnout"** — název souboru `kontakty_<scope>[_firma]_<datum>.<ext>`

---

## 6. Synchronizační logika

### 6.1 Editační flow (lokálně → iCloud)

1. Uživatel edituje buňku → řádek označen dirty + autosave do lokálního
   persistentního souboru (přežije zavření tabu, restart aplikace)
2. Uživatel klikne **Uložit & Sync** → pro každý dirty kontakt:
   - validace polí (datum, e-mail, telefon, povinná pole)
   - sestavení vCard s ETag matchingem (`If-Match: <etag>`)
   - PUT na server
   - lokální záloha původního stavu před zápisem
3. Při ETag konfliktu (412) server zápis odmítne — chrání před přepsáním
   změn z jiného zařízení

### 6.2 Synchronizace iCloud → Google Workspace

**Princip**: pro každý iCloud kontakt najdi protějšek v Googlu, pokud
existuje → UPDATE, jinak → CREATE. **Nikdy nezakládat duplicity.**

**3-úrovňové párování** (Google často přepíše UID, takže UID samotné
nestačí):

1. **UID match** — pokud Google UID zachoval
2. **FN + telefony + e-maily match** — pokud UID neshodný, ale data ano
3. **Pouze telefon match** — krajní fallback

Pokud žádná úroveň nesedne → opravdu nový kontakt, CREATE.

**Implementační detaily**:
- Před každým sync se stáhne aktuální stav Google adresáře
- Throttling 100–200 ms mezi requesty (proti rate limitům)
- Auto-retry s exponenciálním backoffem pro 429/500/502/503/504/timeout
- Progress bar s počítadlem `created / updated / failed`

### 6.3 Cleanup duplicit v Googlu

Pokud z předchozích pokusů zůstaly duplicity:

- **Union-find** přes různé identifikační kanály (telefon, e-mail, jméno-bez-kontaktů)
- Sloučí překryvy do jednoho clusteru (kontakt A1+A2 sdílí telefon, A2+A3
  sdílí e-mail → cluster {A1, A2, A3})
- V každém clusteru zachová **jeden záznam**:
  - preferenčně ten, jehož UID odpovídá UID v iCloudu
  - jinak deterministicky podle nejmenšího href
- Ostatní smaže (DELETE)

### 6.4 Pull-back (Google → iCloud)

Pro kontakty, které existují jen v Googlu (typicky vytvořené přímo tam):
- aplikace ukáže jejich seznam v záložce Google
- tlačítkem se nahrají na iCloud jako nové vCardy se zachováním UID

---

## 7. Skupiny — specifika Apple ekosystému

V Apple CardDAV nejsou skupiny pole na kontaktu, ale **samostatné vCardy**
s typem `group` a seznamem členských UID.

**Aplikace to abstrahuje** — uživatel vidí jen čárkou oddělený seznam
v sloupci „Skupiny" u kontaktu. Při uložení:

1. Aplikace porovná žádaný stav s aktuálním
2. Spočte diff (add/remove členů)
3. Pro každou dotčenou skupinu:
   - existuje → upraví seznam členů a PUT
   - neexistuje → vytvoří nový skupinový vCard
4. Aktualizuje lokální mapu skupin

**Case-insensitive normalizace** při uložení zabraňuje vzniku duplicitních
skupin při různém zápisu velkosti písmen.

---

## 8. Bezpečnostní a integritní mechanismy

| Riziko | Ochrana |
|---|---|
| Přepsání cizí změny | ETag `If-Match` na každém PUT/DELETE |
| Ztráta dat při zápisu | Záloha původního stavu před každou změnou |
| Ztráta dat při mazání | Záloha + povinné potvrzovací dialog |
| Ztráta rozeditovaných změn (zavření tabu) | Autosave dirty řádků po každé editaci |
| Špatný formát dat | Validace polí před odesláním na server |
| Duplicity v Google | 3-úrovňové párování + cleanup nástroj |
| Nevidím novinky z mobilu | Tracking viděných UID + banner s diff |
| Nevím co server uložil | Diagnostický log requests/responses pro audit |
| Náhodný kolemjdoucí | PIN brána s auto-zámkem |
| Zapomenutý PIN | Reset přes smazání hash souboru (zdokumentováno) |

---

## 9. Persistentní lokální data

Aplikace si vytváří dva adresáře (musí přežít restart kontejneru/aplikace):

### `backup/`
- `YYYYMMDD-HHMMSS_before_put_<UID>.vcf` — stav před úpravou
- `YYYYMMDD-HHMMSS_before_delete_<UID>.vcf` — stav před smazáním
- `YYYYMMDD-HHMMSS_AFTER_<UID>.vcf` — stav po PUTu (audit)
- `YYYYMMDD-HHMMSS_PUT_<UID>.log` — diagnostický log

### `drafts/`
- `drafts.json` — rozeditované řádky (autosave po každé buňce)
- `seen_uids.json` — seznam UID, které už aplikace viděla (pro detekci nových)
- `sync_history.json` — časy posledních synchronizací
- `pin.json` — zahashovaný PIN (SHA-256 + salt, oprávnění 600)

---

## 10. Specifická business pravidla (nepřeskakovat)

### Telefony — normalizace na +420
- Cokoli začínající `+` nebo `00` = **nikdy nemodifikovat** (mezinárodní)
- 9místné domácí číslo s CZ prefixem (60[1-8], 70[2-9], 72-77x, 79x mobile;
  2[0-9], 3[1-9], 38[0-9], 4[0-9], 5[0-9] landline) = kandidát na `+420 XXX XXX XXX`
- 9místné číslo NEodpovídající CZ rozsahům = ambiguous, defaultně se neaplikuje
- Uživatel vždy vidí náhled před applem a může ručně přepnout jednotlivé řádky

### Datum narození — normalizace
Akceptované formáty na vstupu: `YYYY-MM-DD`, `D.M.YYYY`, `D/M/YYYY`,
`YYYYMMDD`. Vždy se ukládá jako `YYYY-MM-DD` (ISO).

### Detekce duplicit v iCloudu
- Shoda jména (case-insensitive, trim) → cluster
- Shoda telefonu (posledních 9 číslic po odstranění non-digits)
- Shoda e-mailu (lowercase, trim)
- Merge zachová UID primárního, doplní prázdná pole z ostatních

### Sloučení duplicit
- Primary = uživatelův výběr
- Skalární pole: pokud primary prázdné, vezme se z prvního non-empty secondary
- Telefony: doplnit do volných slotů primary
- Skupiny: union (sjednocení)
- E-maily: doplnit do volných slotů primary
- Po merge: secondary kontakty se smažou (zálohují se)

### Anti-duplicity v Google syncu
**Vždy** se před PUT na Google stahuje aktuální stav adresáře a buduje
matching mapa. Bez tohoto kroku Google vytváří duplicity při každém syncu.

### Autosave drafts
- Trigger: jakákoli změna buňky v gridu
- Strategie: atomický zápis přes `.tmp` → `replace`
- Klíčování: podle href kontaktu (stabilní napříč sessions)
- Při startu aplikace: pokud existují drafts, nabídnout obnovu před prací

---

## 11. Konfigurace přes prostředí

Aplikace čte tyto proměnné z prostředí (s defaulty):

| Proměnná | Default | Účel |
|---|---|---|
| `APPLE_ID` | — | E-mail Apple ID pro CardDAV |
| `APP_PASSWORD` | — | App-specific password Apple |
| `GOOGLE_EMAIL` | — | E-mail Google Workspace (volitelné) |
| `GOOGLE_APP_PASSWORD` | — | App password Google (volitelné) |
| `BACKUP_DIR` | `./backup` | Cesta k záloham |
| `DRAFTS_DIR` | `./drafts` | Cesta k draftům a PIN souboru |
| `PIN_TIMEOUT_MIN` | `30` | Minuty nečinnosti pro auto-zámek |
| `TZ` | `Europe/Prague` | Timezone |

---

## 12. Acceptance criteria (kontrolní seznam pro novou implementaci)

Postavená aplikace by měla splňovat **všechny** následující body:

### Editace
- [ ] Tabulka zobrazí všechny iCloud kontakty s defaultním sortem dle příjmení
- [ ] Editace buňky = single-click vstup do edit modu
- [ ] Enter potvrdí buňku a přejde o řádek níž
- [ ] Edit poznámky a adresy probíhá v popup textarea
- [ ] Změny jsou označené dirty barvou/indikátorem
- [ ] Stránkování s volbou velikosti (10/25/50/100)
- [ ] Fulltextové vyhledávání přes všechna pole

### Synchronizace iCloud
- [ ] „Uložit" pošle dirty kontakty s ETag matchingem
- [ ] Před každým PUT vznikne lokální záloha
- [ ] Validace formátu (datum, e-mail, telefon) před PUT
- [ ] „Synchronizovat" znovustáhne stav ze serveru
- [ ] Detekce nově přidaných UID + banner

### Synchronizace Google
- [ ] Test připojení vrátí počet kontaktů v Google adresáři
- [ ] Sync iCloud → Google **nezakládá duplicity** (3-úrovňové párování)
- [ ] Cleanup duplicit v Googlu (union-find + interactive confirm)
- [ ] Pull-back kontaktů z Googlu, které nejsou v iCloudu
- [ ] Scope dropdown pro výběr podmnožiny (firma/skupina/noví)

### Mazání
- [ ] Checkbox v řádku → potvrzovací panel
- [ ] Hromadné mazání přes „Vybrat" sloupec
- [ ] Před každým DELETE vznikne záloha
- [ ] Obnova ze zálohy přes UI (listuje posledních 80 záloh)

### Duplicity v iCloudu
- [ ] Detekce přes jméno / telefon / e-mail
- [ ] Volba primárního a merge ostatních do něj
- [ ] Telefony se doplní do volných slotů, skupiny union

### Nástroje
- [ ] Find & Replace s regex a case-sensitive volbou + náhled
- [ ] Normalizace +420 s preview a interaktivní volbou ambiguous
- [ ] Import VCF/CSV s detekcí kolizí
- [ ] Validační přehled (počty bez X)

### Skupiny
- [ ] Sloupec „Skupiny" zobrazí čárkou oddělené názvy
- [ ] Změna v buňce updatuje skupinové vCardy na serveru
- [ ] Případná nová skupina se založí automaticky
- [ ] Case-insensitive normalizace zabraňuje duplicitám
- [ ] Chip seznam nad gridem s počty členů

### Export
- [ ] Volba scope (Všichni / Firma / Skupina)
- [ ] Formáty: VCF a CSV (středník, UTF-8 BOM)
- [ ] Checkbox „Firemní export" omezí pole na 7 základních

### Bezpečnost
- [ ] PIN brána při startu, hash + salt v souboru
- [ ] Auto-zámek po N minutách (konfigurovatelné)
- [ ] Manuální tlačítko „Zamknout"
- [ ] Reset PINu zdokumentovaný (smazání souboru)

### Persistence
- [ ] Drafts přežijí restart aplikace a nabídnou obnovu
- [ ] Zálohy přežijí restart kontejneru
- [ ] Historie synchronizací se ukazuje v hero hlavičce

### Deployment
- [ ] Spustitelné v izolovaném kontejneru (Docker / podobné)
- [ ] Konfigurace přes ENV proměnné, nikdy nehardcoded credentials
- [ ] Bind-mount kódu pro snadný hot-reload bez rebuildu
- [ ] Healthcheck endpoint
- [ ] Restart policy „unless-stopped"
- [ ] Auto-připojení při startu pokud jsou kredence v env

---

## 13. UX principy (důležité, neopomenout)

1. **Žádné automatické pozadí** — uživatel má plnou kontrolu nad tím, kdy
   se posílá co kam. Editace lokálně, save explicitní, Google sync
   explicitní.
2. **Single-click editace** — žádné modální okno na úpravu jednoho pole.
3. **Always show consequences** — před destruktivní akcí (smazání, hromadný
   replace) zobraz, čeho se akce týká a kolik záznamů ovlivní.
4. **Recoverable by default** — každý zápis a smazání má zálohu, UI nabízí
   obnovu.
5. **No silent failures** — chybové stavy se hlásí konkrétně (status code,
   důvod), ne obecné „něco selhalo".
6. **Předem nastavená rozumná defaultní hodnota** — např. default sort,
   default page size, default scope exportu.

---

## 14. Konverzační kontext (kdo to chtěl a proč)

- Klient používá iCloud jako primární adresář, ale chce mít kontakty
  i v Google Workspace pro Gmail a další firemní nástroje
- Edituje typicky stovky kontaktů (cca 1000 v knihovně), proto je
  potřeba hromadná editace, find&replace, normalizace, duplicity
- Pracuje občas v terénu (mobil), pak v kanceláři (Mac) — proto detekce
  nově přidaných
- Aplikace běží na vlastním NAS v LAN, ne veřejně dostupná
- Firemní portál umí importovat VCF nebo CSV → potřeba firemního exportu
  s omezenou sadou polí

---

*Cíl: aby šlo tento dokument vzít jako brief do nové AI session a postavit
funkčně ekvivalentní produkt v libovolném stacku (React/Vue/Svelte web,
Electron desktop, Python/Node/Go backend). Funkční chování a business
pravidla zůstávají, technologie je volná volba.*
