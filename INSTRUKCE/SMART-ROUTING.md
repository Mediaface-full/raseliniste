# Smart routing — operativní návod

Jak nakonfigurovat a používat 6-úrovňový routing úkolů z Rašeliniště do Todoistu. Stav 2026-05-10.

---

## TL;DR

Když pushneš úkol do Todoistu, Rašeliniště rozhodne kam podle **prvního pravidla, které sedne** (top-down):

1. **`klient-<slug>` tag** v úkolu → Práce / sekce klienta
2. **`contact.clientTag`** (pokud delegováno na kontaktní osobu klienta) → Práce / sekce klienta
3. **`contact.isTeam`** (Dominik, Agáta) → Práce / sekce jména
4. **běžný kontakt** → Lidé / sekce jména (nebo top-level shared project)
5. **tag z config mapy** (např. `dum`, `zdravi`) → konfigurovaný projekt/sekce
6. **fallback** → mojeUkoly / Inbox

`t-*` tagy (`t-30m`, `t-1h`, ...) se z routing logiky filtrují — jsou jen meta.

---

## Konfigurace, kterou MUSÍŠ udělat poprvé

### 1. Tým členové
**Kde:** `/contacts` → otevři kontakt → blok „Routing úkolů do Todoistu" → checkbox **Tým**

Týmem označuj lidi, se kterými dlouhodobě pracuješ a chceš je v projektu **Práce / sekce <jméno>** (ne v Lidé). Typicky:
- Dominik, Agáta, …

### 2. Klienti
**Kde:** `/contacts` → otevři kontaktní osobu klienta → blok „Routing" → input **Klient slug**

Slug = lowercase, bez diakritiky, oddělovač pomlčka. Příklady:
- *Karel Novák z TK Stavby* → `tk-stavby`
- *Petr Sklář z Mortyk Design* → `mortyk-design`
- *Honza* z firmy bez jasného názvu → klidně `honza-firma`

Můžeš mít víc kontaktních osob u jednoho klienta — všichni dostanou stejný `clientTag`. Routing pak posílá úkoly do **Práce / sekce TK Stavby** ať už delegujeme na kohokoli z nich.

### 3. Todoist konfigurace
**Kde:** `/settings/integrations` → Todoist → blok „Smart routing"

- **Práce projekt** — default `Práce`. Změň jen pokud máš v Todoistu jiný název (např. `Work`, `Mediaface`).
- **Lidé projekt** — default `Lidé`. Změň jen pokud máš jiný název.
- **Mapping tag → projekt / sekce** — pravidlo #5. Příklady:
  ```
  dum     → Osobní / Domov
  zdravi  → Osobní / Zdraví
  dodavka → Osobní / Auto
  hobby   → Osobní / Hobby
  nakup   → Osobní / Nákupy
  ```
  Sekce je volitelná. Pokud necháš prázdné, jde do projektu bez sekce.

**Auto-create:** Pokud projekt nebo sekce v Todoistu neexistuje, Rašeliniště ji při push **vytvoří**. Každý auto-create se loguje v `/settings/crons → Routing audit log` (butter / mint badge).

---

## Jak to funguje při diktování

### V audio diktátu (`/ozvena?mode=task`)

AI dostává v promptu:
- Seznam tvých kontaktů
- **Distinct seznam existujících `clientTag` slugů** z DB
- Pravidla pro klient-* prefix:
  - **Když mluvíš o existujícím klientovi** („pro TK Stavby udělat fakturu") → AI použije PŘESNĚ existující slug `klient-tk-stavby`
  - **Když mluvíš o novém klientovi** („pro nového klienta Vodárny Praha") → AI vytvoří nový slug `klient-vodarny-praha`
  - **Když si není jistý**, žádný `klient-*` tag nepřidá (lepší než hádat)
  - Tag `klient-*` max **1 per úkol** (víc klientů = vyber primárního)

### V Triage review screenu

U každého úkolu vidíš:
- **Trvání dropdown** (Hourglass ikona) — vyber `t-30m` až `t-celý-den` nebo nech `t-?` (default)
- Tagy bez t-*
- Datum, kontakt, prioritu

`t-*` tag jde do Todoistu jako label, ale neovlivňuje routing — je to čistě metadata pro tvou přehled v Todoistu.

### Po klik „Vytvořit zaškrtnuté"

1. Task se uloží do DB (Rašeliniště)
2. Push do Todoistu spustí smart routing
3. Audit log se vytvoří v `RoutingAuditLog`
4. V `/settings/crons → Routing audit log` vidíš:
   - **kdy** byl push
   - **které pravidlo** matchlo (#1-#6)
   - **co matchlo** (slug, jméno, tag)
   - **cíl** (projekt / sekce)
   - **flags** auto-create projektu / sekce

---

## Debug a audit

### `/settings/crons → Routing audit log`
Tabulka 30 posledních push. Zkontroluj:
- **Pravidlo sedí?** — Když očekáváš #1 klient-tag a vidíš #6 fallback, pravděpodobně AI nepřidalo `klient-*` tag. Zkontroluj jestli klient existuje v `/contacts` s `clientTag`.
- **Auto-create flag** — Když Rašeliniště vytvoří nový projekt nebo sekci, je to OK pokud sis to objednal (např. zadal jsi nový tag → AI vytvořil → projekt se auto-vytvořil). Pokud auto-create vidíš a nečekals ho, někdo (AI nebo ty ručně v review) přidal něco neočekávaného.

### Když AI halucinuje slug
Stávalo se: AI vyrobí slug pro neexistujícího klienta s opisem (typicky pro generické zmínky). **Prevence:**
- V audiu mluv konkrétně („pro TK Stavby" lépe než „pro toho stavebního dodavatele")
- V `/contacts` měj nakonfigurované všechny aktivní klienty s `clientTag`
- Když v audit logu vidíš nový auto-created project, který nemá smysl, smaž ho v Todoistu a přidej `clientTag` k tomu, co tam mělo jít místo toho

### Reset routing config
Pokud zaserememe konfiguraci, `/settings/integrations` má ručně všechny fieldy. Stačí přepsat a uložit — `/api/integrations/todoist/config` PATCH merguje s existujícím config (nepřemaže ostatní fieldy).

---

## FAQ

**Q: Co když delegovaný kontakt má `clientTag` I `isTeam`?**
A: `clientTag` má prioritu (pravidlo #2 dříve než #3). Šikovné, když je člen týmu zároveň zástupcem klienta.

**Q: Co když má úkol víc tagů co matchují různým pravidlům?**
A: První pravidlo, co matchne, vyhrává. `klient-*` tag (#1) má vždy přednost před tagToProject (#5).

**Q: Můžu vypnout auto-create?**
A: Zatím ne. Pokud nechceš auto-create, používej jen existující projekty/sekce — Rašeliniště je najde podle jména (case-insensitive).

**Q: Smaže se audit log někdy?**
A: Zatím **NE** — neomezeně roste. Pokud začne zpomalovat `/settings/crons` (typicky po 10k+ záznamech), přidáme cron na delete > 30 dní.

**Q: Jak zjistím, jaké tagy AI očekává?**
A: V promptu dynamicky z DB:
- Kontakty: jména z `Contact.firstName` / `Contact.displayName`
- Klienti: distinct `Contact.clientTag` (slugy)
- Tagy: top 40 z `Task.tags` + `TodoistLabelMirror`

Když chceš nový tag, prostě ho diktuj a AI ho zařadí. Pokud sedne na pravidlo, routing zafunguje.

---

*Dokument se aktualizuje s každou změnou routing logiky. Při změně pravidel uprav i `INSTRUKCE/HANDOFF-*.md` a `HANDBOOK.md`.*
