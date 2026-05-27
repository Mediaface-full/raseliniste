# Úkoly — kompletní workflow

Jak používat úkolový systém Rašeliniště nejefektivněji. Vznikl 2026-05-27
podle bodu #25 ze zpětné vazby (Petr chtěl jasný overview).

---

## Třícestný most: Hlas → Rašeliniště → Todoist

```
┌──────────┐    AI extrakce   ┌────────────┐    Smart routing   ┌──────────┐
│  Diktát  │ ───────────────→ │ Rašeliniště│ ─────────────────→ │ Todoist  │
│ (audio)  │                  │   (Task)   │                    │ (project)│
└──────────┘                  └────────────┘                    └──────────┘
                                    ↑                                  ↑
                                    │       obousměrný sync à 5 min    │
                                    └──────────────────────────────────┘
```

**Klíčové:** Rašeliniště je **sběrna a smart router**. Todoist je nástroj
kde úkoly skutečně řešíš. Sync běží oběma směry — co změníš v Todoistu
(termín, hotovo, smazat), promítne se zpět do Rašeliniště. Co změníš v
Rašeliništi, pushne do Todoistu.

---

## Use case 1: Diktát úkolů (hlavní cesta)

**Kdy**: máš v hlavě 5-50+ úkolů, chceš je vyklopit dřív než zapomeneš.
Auto, kolo, sprcha, procházka — kdykoli máš ruce nebo hlavu plnou.

**Postup**:

1. `/start` → **Ozvěna** (mic ikona, peach tint)
2. Default je mode **task** (pokud potřebuješ deník, přepni switch nahoře)
3. Stiskni **červené tlačítko**, mluvíš, stop. Délka libovolná (60 min OK,
   testovaná 29 min = 36 úkolů). Žádný strop.
4. Audio se nahraje na server (`/api/ukoly/audio`), background processing
5. Auto-redirect na **`/ukoly/audio/<id>/review`** — review screen
6. Vidíš **fáze** (1. Přepis → 2. Úkoly) + **stopky** + audio délku
7. Po dokončení uvidíš **návrhy úkolů** ve struktuře parent + subtasks

**Co AI nabídne:**
- Title (imperativ, „Zavolat Karlovi…")
- Termín (parsuje „zítra", „v pondělí", „do pátku")
- Priority (high jen pokud řekl „důležité"/„urgent")
- Tagy (`dum`, `firma`, `klient-<slug>`, `t-<trvání>`, …)
- Přiřazený kontakt (z aliases v audiu — „Karle", „TK")
- Notes (pokud diktoval kontext / úvahy)
- rawSnippet (5-15 slov z audia pro orientaci)

**Review (vše inline, bez rozkliknutí):**
- ☐ checkbox = vzít / nevzít (default ✓)
- klik na **nadpis** = inline edit (Tab/Enter ukládá)
- Trvání select (`t-?` / `t-30m` / `t-1h` / `t-2h` / `t-půlden` / `t-celý-den`)
- Datum picker
- Priorita dropdown (Low / Normal / Priorita)
- Kontakt dropdown (Já / tým + klienti)
- Tagy text input s čárkou
- Poznámka textarea
- 📁 **chip „Projekt / Sekce"** — kam to půjde v Todoistu (live preview)
- ✕ smazat tento návrh

**Commit:**
- Po review klikni **„Uložit X úkolů"** dole
- Vytvoří Task v Rašeliništi
- Spustí smart routing → push do Todoistu

---

## Use case 2: Nahrát existující audio (m4a/mp3)

**Kdy**: máš nahrané audio z iPhone Voice Recorder, WhatsApp, jiné appky.

**Postup**:

1. `/start` → **Ozvěna** → tlačítko **📎 Nahrát soubor**
2. File picker se otevře (mobile-friendly, žádný redirect)
3. Vyber audio file
4. Upload + processing přesně jako diktát (1-4 nahoře)

**Limit**: 50 MB. Pro 29 min audio cca 27 MB v m4a — OK.

---

## Use case 3: Manuální úkol (jednorázová věc)

**Kdy**: jeden konkrétní úkol, máš pohodlí na klávesnici.

**Postup**:

1. `/ukoly` → tlačítko **+ Nový úkol**
2. Formulář: title, popis, datum, tagy, kontakt, priorita
3. Save → uloží do Rašeliniště + push do Todoistu

---

## Use case 4: Z VIP zprávy (firewall)

**Kdy**: VIP kontakt ti pošle úkol přes `/call-log/?t=<token>`.

**Postup** (automatický):

1. VIP otevře svůj token URL
2. Napíše vzkaz + volitelně termín
3. Vznikne `CallLog` + push notifikace pro tebe
4. Auto-create úkol s hvězdou ⭐ VIP firewall v `/ukoly`

VIP úkoly mají v listu **rose badge ⭐ VIP firewall** + jdou do projektu
„Lidé" v Todoistu (pokud VIP nemá svůj projekt).

---

## Smart routing — kam úkol skončí v Todoistu

**6 pravidel, první match vyhrává:**

1. **tag `klient-<slug>`** → Team Workspace projekt klienta (nebo fallback
   „Práce" / sekce slugu)
2. **kontakt.clientTag** set → projekt klienta
3. **kontakt.isTeam=true** → „Práce" / sekce <jméno>
4. **kontakt (kdokoli jiný)** → „Lidé" / sekce <jméno>
   (NEBO top-level project pokud existuje shared project s tím jménem)
5. **tag z config map** (`dum` → Osobní/Domov, …) → konfigurovatelný projekt
6. **fallback** → Moje úkoly / Inbox

V review screen vidíš preview chip „📁 Projekt / Sekce" — můžeš ovlivnit
změnou kontaktu nebo přidáním `klient-X` tagu.

---

## Filter a search v `/ukoly`

**Filter řádky:**
- Status: Otevřené / Hotové / Vše (default Otevřené)
- Person: Všichni / Moje / Per kontakt (chip s jménem)
- Tagy: chip s počty (top 8) + Search

**Akce na úkolu:**
- Klik na nadpis = inline edit (Tab/Enter)
- ☐ checkbox = hotovo/reopen (sync do Todoistu)
- 🖊 ikonka = plný edit panel (datum, tagy, kontakt, ...)
- 🗑 ikonka = smazat (lokálně + Todoist, optimistic UI)
- 📤 ikonka = push do Todoistu (manuální, default je auto po vytvoření)

---

## Obousměrný sync s Todoistem

- **Cron** `todoist-sync` à 5 min
- **Změna v Rašeliništi** → push do Todoistu (createTask / updateTask /
  closeTask / deleteTask + responsible_uid pokud kontakt má `todoistUserId`)
- **Změna v Todoistu** → pull do Rašeliniště (text, datum, priorita, status)
- **Konflikt**: last-write-wins (na základě `updatedAt` od obou stran)

**Co se NEsyncuje:**
- Notes (Rašeliniště-only field, Todoist description je separate)
- VIP badge (Rašeliniště-only)
- Routing audit (RoutingAuditLog je server-side)

---

## Aliases a Todoist user ID (kdy nastavit)

**Aliases** (`Contact.aliases`, `Contact.clientTagAliases`):
- Synonyma jak Petr osobu v audiu nazývá („Karel", „Kája", „TK")
- AI fuzzy match při extrakci → kanonické jméno do JSON
- Nastavit v `/contacts` → edit kontaktu → comma-separated input

**Todoist user ID** (`Contact.todoistUserId`):
- Pro členy týmu (`isTeam=true`)
- Bez ID: úkol skončí v sekci s jménem, ale asignován ti
- S ID: skutečné Todoist assignment → člen dostane notifikaci
- ID najdeš na **`/api/integrations/todoist/collaborators`** (JSON s
  workspace members)

---

## Tipy na efektivitu

1. **Diktuj long-form** — AI poradí. Lepší 60 úkolů v review (odškrtnu 20)
   než 5 úkolů (10 zapomenutých). Žádný strop na počet.
2. **t-* tagy** v review = trvání. Pomáhá týdennímu plánování (víš že máš
   8h úkolů na pondělí).
3. **Klient-tag manuálně** — pokud AI nematche, přidej `klient-<slug>` v
   review → routing tě hodí do projektu klienta.
4. **isTeam = ano, clientTag = ano** — kontakt může být oba. Routing vybere
   první match (klient-tag má prioritu před isTeam).
5. **Notes vs rawSnippet** — notes je pro tebe (max 1500 znaků), rawSnippet
   je úryvek z audia (5-15 slov pro orientaci).
6. **Vyšší kontrast v listu**: titles `text-base font-medium`, meta řádky
   `foreground/80` — neměj problém přečíst (Petrova preference, 27.5.).

---

## Co se NEpovedlo / je TODO (k 2026-05-27)

- **Mobile editaci úkolů** (body #16, #17) — inline edit v review screen
  hotov, ale plný edit panel v `/ukoly` listu je zatím desktop-only.
- **Auto-tagging v deníku** (#19) — viz UKOLY-WORKFLOW pro úkoly, deník
  zatím sám tagy negeneruje.
- **Recurring tasks** — Task model má jen single `dueAt`, Todoist recurring
  se rozjede (sync nezachová pattern). Pokud používáš recurring, drž je v
  Todoistu, ne v Rašeliništi.

---

**Referenční soubory v kódu:**
- `src/lib/process-task-audio.ts` — AI pipeline (transkripce + extrakce)
- `src/lib/ai-prompts.ts` — prompt „ozvena-stage2-task"
- `src/lib/task-todoist-push.ts` — smart routing (6 pravidel)
- `src/lib/todoist-sync.ts` — pull/push à 5 min
- `src/components/UkolyList.tsx` — list úkolů + inline edit
- `src/components/TaskAudioReview.tsx` — review screen po diktátu
