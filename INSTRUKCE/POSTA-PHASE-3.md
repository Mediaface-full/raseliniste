# Pošta — fáze 3 (UI modul `/posta`)

> Stav k 2026-05-12: **HOTOVO**. Fáze 4 (RAG embeddings + search) čeká.

UI modul pro práci s klasifikovanou poštou. Server-side rendered Astro
stránka s native HTML formuláři — zero JS islands per Petrovo zadání.

## Architektura

```
[Petr otevře /posta]
  ↓
[posta.astro SSR]
  ├── readSession() → userId
  ├── Parse ?filter & ?q z URL
  ├── Načti EmailDigest pro dnešek (pokud existuje)
  ├── Načti EmailMessage[] WHERE filter + search (max 100)
  ├── Spočti chip counts (5 parallel Promise.all)
  └── Render:
       1. Digest karta (top akce + eskalace + summary + counts)
       2. Filter chips (s counts)
       3. Search form (GET)
       4. List karet jako <details> (expand v místě)

[Klik filter chip] → GET /posta?filter=X&q=Y → re-render
[Klik karta]       → <details> open (browser native)
[Klik "Označit"]   → POST form /api/posta/:id/resolve → redirect zpět
[Klik "Otevřít"]   → external link na Gmail thread

[Sidebar badge counter]
  ↓ readSession() v Shell.astro
  ↓ getPostaBadgeCount(userId) — cache 60s in-memory
  └── count WHERE actionType=action_required
                   AND (urgency=high OR escalation=true)
                   AND resolvedAt IS NULL

[Cron posta-digest daily 7:00]
  ↓ /api/cron/posta-digest (x-cron-key)
  └── generateDigestForUser per Google integration
      ├── načti aktivní klasifikované maily (max 200)
      ├── topActions, escalations, waitingExternal, counts
      ├── Gemini Flash summary 1-2 věty (klidně, ne dramaticky)
      └── upsert EmailDigest
```

## Co je hotové

| Komponenta | Cesta | Co dělá |
|---|---|---|
| Schema | migrace `add_posta_resolve_and_digest` | `EmailMessage.resolvedAt/Reason` + `EmailDigest` model |
| Sidebar item | `Shell.astro` | Nová skupina "Komunikace" → "Pošta" s cool-blue tintem + badge |
| Badge counter | `src/lib/posta-badge.ts` | `getPostaBadgeCount(userId)` s 60s cache, invalidace po resolve |
| Hlavní stránka | `src/pages/posta.astro` | SSR — digest sekce + filter chips + search + karty s expand |
| Resolve API | `src/pages/api/posta/[id]/resolve.ts` | POST form action, set `resolvedAt` + invalidate badge |
| Unresolve API | `src/pages/api/posta/[id]/unresolve.ts` | Undo (vrátit do aktivních) |
| Digest generator | `src/lib/posta-digest.ts` | `generateDigestForUser`, idempotent (force flag) |
| Digest cron | `posta-digest` daily 7:00 | Per Google integration user |
| Digest manuál | `POST /api/integrations/google/posta-digest` | UI tlačítko force=true |
| UI dashboard rozšíření | `PostaIntegration.tsx` | Tlačítko „Vygenerovat digest" |

## Karta v listu — vizuální layout

```
┌────────────────────────────────────────────────────────────────────┐
│ ● Karel Novák · před 2 h                                  ▼  │
│   Žádost o schválení faktury 04/2026                              │
│   Klient žádá schválení faktury TK Stavby do pátku 17.5.          │
│   → schválit fakturu do pátku                                     │
│   klient · urgency: medium · eskalace                             │
└────────────────────────────────────────────────────────────────────┘
       ↑ subtilní amber tečka pro urgency=high (per Petrovo zadání)
         rose pro escalation, jinak neutrální foreground/15

Klik karta → <details> open:
┌────────────────────────────────────────────────────────────────────┐
│ ● Karel Novák · před 2 h                                  ▲  │
│   ... (původní obsah)                                              │
│ ────────────────────────────────────────────────────────           │
│ Plný Gmail snippet text — preview celého mailu (~150 znaků).      │
│                                                                    │
│ Od:        karel.novak@tk-stavby.cz                               │
│ Pro:       petr@mediaface.cz                                       │
│ Přijato:   12. 5. 2026 14:23                                       │
│ Projekt:   TK Stavby                                               │
│ Labely:    INBOX, IMPORTANT                                        │
│ klasifikováno před 30 min (gemini-2.5-flash+classify_v1, conf 0.92)│
│                                                                    │
│ [↗ Otevřít v Gmailu]  [✓ Označit jako vyřízené]                  │
└────────────────────────────────────────────────────────────────────┘
```

Vyřízená karta: `opacity 65 + border-white/5 + "vyřízeno před X dny"` badge.

## Akce

| Akce | Mechanika |
|---|---|
| Filter | GET form, link s `?filter=X` |
| Search | GET form, `?q=...` (fulltext ILIKE subject/from/snippet) |
| Expand karta | Browser native `<details>` element, žádný JS |
| Otevřít v Gmailu | `<a href="https://mail.google.com/mail/u/0/#inbox/{threadId}" target="_blank">` |
| Označit jako vyřízené | POST form `/api/posta/:id/resolve`, redirect zpět na current URL |
| Vrátit do aktivních | POST form `/api/posta/:id/unresolve` |

**Zero JS islands.** Vše přes server roundtrip — odpovídá Astro filozofii
a Petrovo "static SSR, refresh při návštěvě".

## Sidebar badge

```
┌─────────────────────────┐
│ Komunikace              │
│   ✉ Pošta          [ 3 ]│  ← počet AKTIVNÍCH action_required
└─────────────────────────┘                       s urgency=high
                                                  NEBO escalation=true
```

Cache: **60s in-memory per userId** (Map).
- `getPostaBadgeCount(userId)` — read-through
- `invalidatePostaBadgeCache(userId)` — volá se z resolve/unresolve endpointu

Single-user instance v praxi 1 záznam v Map. Multi-user OK do desítek
uživatelů. Pro tisíce přejít na Redis nebo HTTP cache headers.

## Digest

### Generování
Cron **`posta-digest` daily 7:00** (vedle existujícího daily-projects-digest).
- Pro každého usera s `UserIntegration(provider="google")`
- Idempotence: pokud `EmailDigest` pro `forDate` existuje → no-op (cron může
  běžet dvakrát = OK). Manuál s `force: true` přepíše.
- Načte max 200 aktivních klasifikovaných mailů
- Agregace: topActions (urgency desc), escalations, waitingExternal, counts
- Gemini Flash 1-2 věty summary (prompt instruction: *„Petr má CPTSD + ADHD —
  buď klidný a věcný, ne dramatický"*)
- Při 0 aktivních: fallback string „Žádná aktivní pošta. Klid." (no LLM call,
  šetří tokeny + Petr nemá co řešit)

### Content schema (JSONB)
```ts
{
  topActions: Array<{ emailId, subject, fromName, urgency, suggestedAction, reason }>,
  escalations: Array<{ emailId, subject, fromName, urgency, reason }>,
  waitingExternal: Array<{ emailId, subject, toAddresses, since }>,
  counts: {
    actionType: { action_required: N, waiting_external: M, ... },
    contentType: { klient: N, newsletter: M, ... }
  },
  summary: "1-2 věty LLM reflexe",
  model: "gemini-2.5-flash",
  totalActiveEmails: N
}
```

Schema záměrně **loose** — když Petr pošle finální mockup ze `SPEC.md`,
strukturu lze rozšířit bez migrace (JSONB sloupec).

### Cost reality check
- 1 LLM call/den/user = ~500 input tokens + 100 output tokens
- Gemini Flash: (500×0.075 + 100×0.30) / 1M = **~0.00006 USD/den/user**
- Ročně: **~0.022 USD = 50 hal/rok**. Zanedbatelné.

## Wabi-sabi & accessibility

Per Petrovo zadání:
- **Tmavé téma** — sdílí existující design tokens (`--background`, `--foreground`, `--tint-*`)
- **Tlumené pastely** — žádné neon, žádné gradienty
- **Akcent urgency=high** — `var(--tint-butter)` jako subtilní tečka 2px, ne ostrá barva
- **Akcent escalation** — `var(--tint-rose) 40%` tečka, ne crimson
- **Žádné aria-live regions** ani toast notifikace — vše je v UI viditelné, není potřeba accessible alerts pro single-user
- **Filter chips** mají počet pro orientaci, ne pro tlak (žádné „přečti všech 47!")

## Ověření po deploy

1. **OAuth refresh** (pokud jsi to nedělal) — Google scope rozšířen o gmail.readonly + gmail.metadata
2. Spustit sync + klasifikaci → ověřit že máš ~50 klasifikovaných mailů
3. **Otevřít `/posta`** v prohlížeči — uvidíš:
   - Digest placeholder (digest nevygenerován pro dnešek)
   - 5 filter chips: Vyřídit / Čeká na druhé / K přečtení / Šum / Vyřízené
   - List karet
4. Klik na kartu → expand
5. Klik **„Označit jako vyřízené"** → karta zmizí z filtru `action_required`, objeví se v `Vyřízené` s opacity
6. Klik **„↗ Otevřít v Gmailu"** → nový tab s Gmail thread view
7. **Sidebar badge** — počet u Pošty by měl odrážet action_required+(high|escalation)+resolvedAt IS NULL
8. **Vygenerovat digest** v `/settings/integrations/google` → znovu otevři `/posta` → vidíš digest kartu se shrnutím

## Známé limity fáze 3

1. **Search jen ILIKE substring** — fáze 4 přidá embedding search přes pgvector
   (`RagChunk.sourceType="email"`)
2. **Bez paginace** — max 100 mailů per stránka. Při větším volumu přidat
   cursor-based paging (faze 5+)
3. **Žádný keyboard navigation** — Petr explicitně nepožadoval. V budoucnu
   J/K pro next/prev karta, ESC pro collapse
4. **Žádný bulk select** — označit více mailů najednou. Hodí se pro
   batch archivaci newsletterů. Faze 5+
5. **Digest format `SPEC.md` zatím neexistuje** — default mockup
   v posta-digest.ts může být upraven když Petr pošle finální vizuální
   návrh. Content JSON schema loose, neměly by být breaking změny

## 3 nezodpovězené otázky blokující fázi 4 (RAG + search)

### 1. Backfill existujících mailů — všechny nebo postupně?

Po nasazení RAG chunkingu chceme zembedovat existující ~N mailů. Možnosti:
- **(a) Full backfill jednorázově** — spustit init endpoint, projít všechny,
  cca 5-10 minut work + 1-3 USD cost. Plus: ihned funkční search nad historií.
  Minus: krátkodobá zátěž.
- **(b) Postupně přes cron** — embedding při příchodu (po klasifikaci) +
  background cron pro historic batch po 100 mailech každých 15 min. Plus:
  rozloženo. Minus: pár dní než je celá historie indexovaná.

### 2. Search UI — kde žije?

- **(a) Stejný search input v `/posta`** — fulltext ILIKE → vector search,
  výsledky agregované per mail (max chunk score). Plus: jeden vstupní bod.
  Minus: ILIKE pro krátké queries (např. „faktura") je rychlejší než vector;
  hybrid logic = víc kódu.
- **(b) Separátní `/posta/search`** stránka s pokročilým UI. Plus: čisté
  oddělení. Minus: další navigation.
- **(c) Rozšířit existující `/zeptat-se`** o `sourceType="email"`. Plus:
  unified search napříč deníky/úkoly/Studánky/maily. Minus: vyžaduje
  refaktor existující RAG infrastruktury.

### 3. Chunking — kdy spustit?

Embedding generujeme z `bodyText`. Otázka kdy:
- **(a) Synchronně v posta-classify.ts** — po klasifikaci hned i embed.
  Plus: nový mail = okamžitě hledatelný. Minus: classify cron je už 30s+
  per batch; pridat dalších 5-10s na batch.
- **(b) Separátní cron `posta-embed`** every 30 min. Plus: oddělené
  performance. Minus: 30 min delay v indexaci.
- **(c) Trigger po resolve** — embed jen mailů co Petr nějak zpracoval.
  Plus: drasticky méně embeddings. Minus: nehledá v noise/spam = OK pro
  většinu cases, ale Petr nemusí najít „ten newsletter co měl link na X".
