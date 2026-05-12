# Pošta — retention politika (96 dnů)

> Stav 2026-05-12, fáze 5. **Závazný dokument** — cleanup logika v
> `src/lib/posta-cleanup.ts` a cron `posta-cleanup` denně 03:00 se musí
> shodovat s tímto popisem.

## Princip: selektivní cleanup, NE delete row

Po 96 dnech od `EmailMessage.receivedAt` se z mailu **nuluje raw paket**
(velký, redundantní pro každodenní práci), ale **zachová** kompaktní
abstrakce použitelná pro search a historický kontext.

Důsledek: máš 5+ let historie hledatelnou skrz `/posta?q=...`, ale jen
posledních 96 dnů má plný originální body. Pro starší → "Otevřít v Gmailu"
deeplink, Gmail má vlastní retention (typicky bez limitu).

## Co se MAŽE po 96 dnech

| Pole | Důvod |
|---|---|
| `bodyText` | velký text, redundantní (chunks už mají komprimovanou verzi) |
| `bodyHtml` | ještě větší, formátování není pro search nutné |
| `attachments` (JSON metadata) | filename + mime + sizeBytes — bez attachmentId po 96 dnech stejně Gmail API nemusí přílohy mít |
| `rawHeaders` (JSONB) | DKIM/SPF/X-* headers, audit only, po 96 dnech irelevantní |

Tj. `EmailMessage` row **zůstane**, jen ty 4 sloupce se nullují.
`bodyDeletedAt` se nastaví jako audit timestamp.

## Co se ZACHOVÁ

| Pole | Důvod |
|---|---|
| `gmailMessageId`, `threadId` | deeplink "Otevřít v Gmailu" funguje pořád |
| `subject` | UI render |
| `fromAddress`, `fromName`, `toAddresses`, `ccAddresses` | filtry, search |
| `snippet` | ~150 znaků Gmail-generated preview, plain text |
| `labels[]` | filtering |
| `receivedAt`, `importedAt` | sort, time-based filters |
| `hasAttachments` (bool) | UI indikátor |
| `resolvedAt`, `resolvedReason` | stav (vyřízené / aktivní) |
| `embeddedAt` | flag že embeddings existují |
| `EmailClassification` (1:1 row) | klasifikace = úplná abstrakce |
| `RagChunk` (sourceType="email") | chunks.text + embeddings = search funguje |
| `EmailDigest` | denní snapshots, ne body-dependent |

## Co se NESMAŽE NIKDY (i po 96 dnech)

- **EmailClassification** — i historický kontext potřebuje klasifikaci
- **RagChunk** — chunks mají kompresovanou verzi body (typicky 400 tok
  vs. 4000 tok plný body); search nad celou historii by jinak neměl
  čeho najít
- **Embedding vektor** — neuvádět v null, pgvector index by se rozbil
- **Audit pole** (`bodyDeletedAt`) — jednou true, navždy true

## Co se MAŽE jen přes Full delete API

`DELETE /api/posta/emails/:id?full=true` (fáze 5, separátní commit):
- Smaže `EmailMessage` row + cascade `EmailClassification` + manuálně
  `RagChunk[]` + audit zápis do `PostaDeletionLog`
- Pro GDPR-style "smaž všechno" requesty
- Audit log zůstává navždy (right to be forgotten s evidence)

## Cron `posta-cleanup`

- **Schedule:** daily 03:00 (vedle cleanup-audio 03:00 / cleanup-spiz 03:10 / cleanup-sms 03:30)
- **Batch size:** 1000 mailů per UPDATE (transactional)
- **Idempotence:** WHERE bodyDeletedAt IS NULL → druhý run skip
- **Logy:** strukturované `[posta-cleanup] cleaned=N batches=K cutoff=ISO duration=Yms`

## Manuální spuštění

```bash
# Dry-run — spočítat kandidáty
npm run posta:cleanup -- --dry-run

# Skutečný cleanup
npm run posta:cleanup -- --confirm
```

Skript v `scripts/posta-cleanup.ts` volá stejnou `runRetentionCleanup()`
funkci jako cron — single source of truth.

## Inspekce po cleanup

```sql
-- Kolik mailů má nulovaný body
SELECT COUNT(*) FROM "EmailMessage" WHERE "bodyDeletedAt" IS NOT NULL;

-- Distribuce po měsících (oldest first)
SELECT
  DATE_TRUNC('month', "receivedAt") AS month,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE "bodyDeletedAt" IS NOT NULL) AS cleaned
FROM "EmailMessage"
GROUP BY 1
ORDER BY 1 ASC;

-- Velikost úspory (DB storage)
-- SELECT pg_total_relation_size('"EmailMessage"') / 1024 / 1024 || ' MB';
```

## Důvod 96 dnů (ne 30, ne 365)

- **30 dnů** příliš krátký pro klientské cykly — Petr by ztratil kontext
  na rozjeté projekty. Klient pošle mail, Petr se ozve za měsíc, nebude mít
  originál.
- **365 dnů** zbytečné — pro téměř všechny use cases stačí 90+ dnů; co
  je starší, je hledáno přes search (klasifikace + chunks jsou v DB navždy).
- **96 dnů** = ~3.2 měsíce — pokrývá kvartální cykly s rezervou. Plus
  Petrovo zadání to specifikuje.

## Změny v budoucnu

- **Per-class retention:** klient mails → 365 dní, newsletter → 30 dní,
  spam → 7 dní. Vyžadovalo by sloupec `bodyRetentionDays` per mail nebo
  per `contentType` lookup table. Faze 5+ pokud bude potřeba.
- **Per-pin retention:** Petr může označit mail jako "keep forever"
  (flag `keepBodyForever`). Cleanup ho přeskočí. Faze 5+ pokud Petr
  reálně narazí na case.
