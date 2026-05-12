# Pošta — fáze 1 (Gmail OAuth + import skeleton)

> Stav k 2026-05-12: **HOTOVO**. Fáze 2 (klasifikace, embeddingy, UI) čeká.

Email Intelligence modul "Pošta" — vrstva nad pracovním Gmailem.
Tato fáze: čistý OAuth + import + storage. Bez klasifikace, bez UI.

## Hranice fáze 1

| Co je hotové | Co ještě není |
|---|---|
| Gmail OAuth scope (`gmail.readonly` + `gmail.metadata`) | `gmail.modify` scope (odpovídání, label changes) |
| `EmailMessage` schema + migrace | `EmailClassification`, `EmailDigest`, `EmailCommitment` |
| `src/lib/gmail.ts` API klient | Gmail push notifications (Cloud Pub/Sub) |
| Sync logika `posta-sync.ts` + cron 15 min | Pravá incremental přes `users.history.list` |
| Init endpoint + UI karta | Modul `/posta` (seznam + detail thread) |
| Rate limit handling (1s/4s/16s backoff) | AI klasifikace + RAG indexace |
| Idempotentní storage (`gmailMessageId @unique`) | 96denní retention cron pro `bodyText/Html` |
| Strukturované logování | Šifrování bodyText/Html at-rest |

## Architektura

```
[Petr]
  ↓ klikne "Spustit první import"
  ↓
[POST /api/integrations/google/posta-init]
  ↓ session auth
  ↓
[syncPostaForUser(userId)] ── src/lib/posta-sync.ts
  ↓
  ├── getProfile(userId)             → email + aktuální historyId
  ├── listMessages(q="newer_than:7d") → IDs (max 100)
  ├── existing := SELECT FROM EmailMessage WHERE gmailMessageId IN (...)
  │   (skip duplicities)
  ├── for each new ID:
  │     getMessage(id) → parseGmailMessage → upsert do DB
  │     sleep 50ms
  └── UPDATE User SET gmailHistoryId, gmailSyncedAt

[Cron každých 15 min]
  ↓ /api/cron/posta-sync (x-cron-key auth)
  ↓ stejný syncPostaForUser, ale q="newer_than:1d"
```

## DB schema

`EmailMessage` (migrace `add_posta_phase1`):
- `gmailMessageId @unique` — Gmail 16-znakový hex ID, idempotence
- `threadId` — sjednocení konverzace
- `fromAddress`, `fromName`, `toAddresses[]`, `ccAddresses[]`, `bccAddresses[]`
- `subject`, `snippet` (Gmail-generated 150 znaků preview)
- `bodyText`, `bodyHtml` — base64url-decoded UTF-8
- `labels[]` — Gmail labely (INBOX, IMPORTANT, CATEGORY_*)
- `hasAttachments`, `attachments` (JSON metadata, NE payload)
- `rawHeaders` (JSONB — pro budoucí DKIM/SPF/X-* analýzu)
- `receivedAt` (z Gmail `internalDate`), `importedAt`
- `bodyDeletedAt` — pro 96denní retention cleanup (fáze 2)

`User` (+ 3 fields):
- `gmailHistoryId` — kurzor pro future incremental sync
- `gmailSyncedAt`, `gmailSyncError`

## OAuth scopes

V `src/lib/google-oauth.ts`:
```ts
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",   // ← fáze 1
  "https://www.googleapis.com/auth/gmail.metadata",   // ← fáze 1
];
```

Pokud máš Google už připojený z dřívějška (jen Calendar+Contacts),
musíš **OAuth flow opakovat** — Google ti rozšířený scope nedá
retroaktivně. Postup:

1. `/settings/integrations/google` → tlačítko **Odpojit Google**
2. Pak **Připojit Google** znovu → consent screen zobrazí 4 scope
3. Klikni **Allow**

## Rate limit

Gmail API quota: **250 quota units / user / second**
- `users.messages.list` = 5 units
- `users.messages.get` = 5 units
- `users.getProfile` = 1 unit
- `users.history.list` = 2 units

Při 100 mailech v jednom syncu: 100 × 5 + 1 = **501 units** (~2 sekundy
worth of quota). Sync běží serial s 50ms sleep mezi calls → ~5s reálně.
Daleko od limitu.

429 handling: `withRetry` v `gmail.ts` s exponential backoff
(1s, 4s, 16s). Non-retryable status codes: 400/401/403/404.

## Ověření importu

### V UI
`/settings/integrations/google` → karta **Pošta** → vidíš:
- Počet importovaných mailů
- Poslední sync timestamp
- Last error (pokud nějaký)

### V DB (SSH na Synology)
```bash
ssh root@SPIZ
cd /volume1/docker/raseliniste
sudo docker compose exec postgres psql -U raseliniste -d raseliniste
```
```sql
-- Kolik mailů máš?
SELECT COUNT(*) FROM "EmailMessage" WHERE "userId" = '<tvuj-userId>';

-- Posledních 5
SELECT "fromAddress", "subject", "receivedAt", "labels"
FROM "EmailMessage"
ORDER BY "receivedAt" DESC LIMIT 5;

-- Sync state
SELECT "gmailHistoryId", "gmailSyncedAt", "gmailSyncError"
FROM "User" WHERE id = '<tvuj-userId>';
```

### V cron logu
```bash
sudo docker compose logs app --tail 200 | grep posta-sync
# [posta-sync] userId=... mode=init imported=23 skipped=0 errors=0 duration=4823ms
```

## Testování

Petrovo zadání pošlo: **testy s mock Gmail API**.

**Současný stav:** Rašeliniště nemá test framework (Vitest/Jest).
Validace přes:
1. `npx astro build` (TypeScript + Vite bundle)
2. Manuální QA proti reálnému Gmailu

**Doporučení pro budoucnost:**
Pokud chceme proper testy, přidat Vitest do projektu (1-2 hodiny setup):
- `npm i -D vitest @vitest/ui`
- `vitest.config.ts` s aliasy (`@/lib` atd.)
- Mock Gmail API přes `vi.mock("./gmail")`
- Test scenáře: happy path (parseGmailMessage), 429 retry, idempotence
  upsert, base64url decode edge cases

Vitest by se hodil i pro stávající kód (audio-transcribe, things-import,
…). Až bude přidán, doplníme posta-sync testy zvlášť.

## Známé limity fáze 1

1. **Bez pravého incremental** — používáme `q="newer_than:1d"` místo
   `users.history.list?startHistoryId=X`. Pro fázi 1 to stačí, ale:
   - Pokud uživatel maže/archivuje mail, my to nevidíme
   - Pokud Gmail labely se změní, vidíme to až při dalším re-sync
     stejné zprávy (upsert update labels)

2. **Max 100 mailů per sync** — pro starší než 7 dnů (init) / 1 den
   (incremental) musí uživatel počkat na další cron běh nebo
   ručně spustit sync.

3. **Žádné šifrování bodyText/Html** v DB. Single-user instance v
   interní síti, ale citlivá data. Fáze 2 přidá AES-256-GCM.

4. **Žádný cleanup cron** — 96denní retention bodyText/Html ještě
   neimplementován. Bude přidán až bude objem mailů reálný (po fázi 2).

5. **Single-thread per user** — serial fetch 100 mailů ~5s. Při větším
   volume (1000+) by paralelizace pomohla, ale Gmail quota limit
   (250/s/user) by stejně omezil.

## 3 otázky — ZODPOVĚZENY (viz `POSTA-DESIGN-DECISIONS.md`)

**Pro implementaci fází 2+ se ŘÍDIT** `INSTRUKCE/POSTA-DESIGN-DECISIONS.md`,
ne tímhle dokumentem. Zde jen historický záznam diskuze.

## 3 původní otázky

1. **AI klasifikace — kolik kategorií + jaké?**
   Návrh: `priority (low/med/high)` + `category (klient | osobni |
   newsletter | admin | spam | reklama | systemový | bezpecnost)`
   + `needsAction (bool)` + `suggestedAction (string?)`. Petr —
   souhlasíš s tímhle členěním, nebo máš preference? Hlavně:
   chceš víc/méně kategorií, jiné názvy, automatické tagy?

2. **RAG — embedding granularita?**
   Možnosti:
   (a) **1 embedding per email** (cely subject+body do 1 vektoru).
       Jednoduché, ale dlouhý mail = ztráta detailu.
   (b) **1 embedding per chunk** (rozdelit body na 500-token kusy
       a každý zembedovat zvlášť). Lepší recall, ale 3-5× víc
       embeddings = 3-5× větší DB a compute náklady.
   Co preferuješ?

3. **Vyšumělé závazky — auto-create Task nebo jen flag?**
   Možnosti:
   (a) AI detekuje *"slíbil jsi odpovědět do pátku"* → AUTOMATICKY
       vytvoří `Task` co projde smart routingem. Plus: nic
       neuteče. Minus: může vyrobit hluk (false positives).
   (b) AI detekuje → uloží do `EmailCommitment` tabulky → Petr v
       UI vidí návrhy a klikem akceptuje/zamítne. Plus: kontrola.
       Minus: další manuální krok.
   Co preferuješ?
