# Návod: Úkoly a Plánování týdne

**Pro:** Gideon
**Cíl:** jeden dokument, ve kterém je celý pracovní tok — od nadiktovaného úkolu po naplánovaný týden a informovanou kolegyni.
**V appce:** stejný návod najdeš v **Návody → Plánování týdne** a **Návody → Úkoly**.

---

## Hlavní myšlenka (jedna věta)

> **Rozhodnutí, KDY úkol udělám, je důležitější než rozhodnutí, dokdy má být hotový.**

Termín (deadline) je informace od klienta. **Plánovaný den výroby** (execution date) je tvoje rozhodnutí. Úkol bez naplánovaného dne se řeší, až když klient zavolá — a přesně tomu se tenhle systém brání.

---

## 1. Kudy tečou úkoly (sběr)

| Co chci | Kde | Jak |
|---|---|---|
| Vyklopit úkol hlasem | Dashboard nebo `/ukoly` | **Nahrát úkol** (mikrofon) — klik = start, klik = stop |
| Nahrát dlouhé audio (porada) | `/ukoly` | **📎 Nahrát soubor** — AI vytáhne klidně 30+ úkolů |
| Napsat úkol ručně | `/ukoly` | **+ Nový úkol** |
| Zkontrolovat AI extrakci | review screen po nahrávce | vše inline: datum, priorita, kontakt, tagy, trvání (t-*) |
| Delegovat | review nebo `/ukoly` | přiřaď kontakt — smart routing pošle úkol do správného Todoist projektu/sekce, kolega dostane notifikaci |

Todoist zůstává primární nástroj — všechno se tam obousměrně synchronizuje à 5 minut. Rašeliniště je sběrna, router a **plánovací vrstva**.

---

## 2. Plánování týdne — `/planovani`

*(sidebar → Organizace → Plánování týdne)*

### Board

- **Vlevo Backlog** — všechny otevřené nenaplánované úkoly, seřazené podle priority a termínu. Nahoře hledání.
- **Sloupce Po–Ne** — přetáhni kartu na den, **kdy to budeš dělat**. Na mobilu použij výběr „→ den" na kartě.
- **Max 3 úkoly na den.** Víc = červené počítadlo + varování. To není dekorace — WIP limit tě fyzicky nutí dokončovat, ne rozdělávat.
- **Fajfka** na kartě = hotovo (propíše se do Todoistu).
- **Šipky ‹ ›** = jiný týden; „dnes" tě vrátí na aktuální.
- Co nedoděláš, **vrátí se samo do backlogu** s korálovým štítkem „nedokončeno z minula". Nic se neztrácí.
- Červený termín na kartě = plánuješ dělat úkol až po jeho termínu — vědomé rozhodnutí, ne přehlédnutí.

### Karta úkolu

Tečka = priorita (korálová vysoká, žlutá normální, šedá nízká) · název projektu/klienta z Todoistu · termín („do 24. 7.").

---

## 3. Nedělní rituál — weekly review (30 minut)

**Neděle 18:30** ti přijde push „Nedělní plánování týdne". Postup:

1. Otevři `/planovani`.
2. Klikni **Navrhnout týden (AI)**. AI vezme backlog, termíny, priority, projekty **a tvůj kalendář** (kolik hodin schůzek má který den) a navrhne rozložení.
3. Projdi návrhy — každý má checkbox a důvod („batching s dalším úkolem Radys", „termín zítra, co nejdřív"). Odškrtni, co nechceš.
4. **Potvrdit vybrané** — karty se rozskočí na dny.
5. Dotáhni ručně: přesuň, co nesedí. Hotovo.

Co AI hlídá za tebe: batching po klientech (jeden klient = jeden den), WIP 3/den, dny plné schůzek dostanou max 1 úkol, víkend jen nutné, co se nevejde zůstává v backlogu (s vysvětlením ve varování). **AI nikdy nezapisuje sama** — vždy jen návrh k potvrzení.

> Rada z metodiky: prvních pár týdnů plánuj **polovinu** toho, co si myslíš, že stihneš.

---

## 4. Šablona týdne (theme days)

*Sbalený řádek „Šablona týdne" nad boardem.*

Každému dni přiřaď režim:

| Režim | K čemu | Příklad |
|---|---|---|
| **Manager** | schůzky, hovory, e-maily, admin, fakturace | pondělí, pátek |
| **Maker** | deep work pro klienty — bloky, žádné schůzky | úterý, středa |
| **Vlastní** | vlastní projekty — **nedotknutelné** | čtvrtek |
| **Volno** | neplánovat práci | víkend |

Co to dělá:

1. **Badge nad sloupci boardu** — při plánování hned vidíš, co kam patří.
2. **AI plánuje podle režimů** — klientské úkoly na maker dny, admin na manager dny, do vlastního dne výhradně vlastní projekty.
3. **Hlídá schůzky** — když se schůzka (quickadd, booking) navrhne na maker/vlastní den, slot **zežloutne**: „schůzky patří na manager dny". Neblokuje — připomíná, že jedna schůzka ve 14:00 zabije celý maker den.

Tip: v **Nastavení bookingu** navíc omez dny pro jednotlivé typy schůzek (Praha/online/oběd) jen na manager dny — pak klienti přes pozvánky maker dny vůbec neuvidí.

---

## 5. Digest pro kolegyni

*Sbalený řádek „Digest pro kolegyni" na `/planovani`.*

- Vyber týmový kontakt (musí mít e-mail v Kontaktech), zaškrtni **posílat denně**, ulož.
- **Náhled** ti ukáže přesně, co by dnes odešlo — vyzkoušej před zapnutím.
- Každý **pracovní den v 7:00** jí přijde e-mail:
  - **Petr dnes dělá** — úkoly naplánované na dnešek,
  - **Dnešní schůzky** — časy z kalendáře,
  - **Zítra v plánu**,
  - **Připrav prosím / tvoje úkoly** — úkoly přiřazené jí s termínem do 7 dnů.
- Prázdný den se neposílá, víkendy se přeskakují.

Tím kolegyně ví: „Petr má Radys ve středu, podklady mu musím dodat v úterý večer." Bez ptaní.

---

## 6. Kde co uvidím

- **Dashboard → Dnes** — úkoly s dnešním termínem i úkoly **naplánované** na dnešek (stav „naplánováno").
- **`/planovani`** — celý týden.
- **`/ukoly`** — kompletní seznam s filtry (plánování termíny nemění).
- **Todoist** — všechno jako dřív; plánovaný den je jen v Rašeliništi.

## 7. Skripty do praxe (z metodiky)

- Klient tlačí na termín: *„Nejbližší volný blok pro tvůj projekt mám [den z boardu]. Vrátím se ti do konce toho týdne."*
- Chuť začít nový úkol hned: pokud zabere víc než 2 minuty — **nezačínej**. Hoď do úkolů (hlasem, 10 vteřin) a rozhodni v neděli.
- Sedíš 3 hodiny v e-mailech: *„Na kterém sloupci boardu tohle je?"* Pokud na žádném — nedělej to.

---

*Zdroj metodiky: „Systém sebeřízení a plánování pro kreativce s ADHD" (Maker vs. Manager schedule — Paul Graham; Personal Kanban — Jim Benson; container time-blocking). Implementováno v Rašeliništi 22. 7. 2026.*
