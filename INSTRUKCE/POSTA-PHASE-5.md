# Pošta — fáze 5 (Gmail push + encryption + retention)

> Stav k 2026-05-12: **HOTOVO**. Fáze 6 (DetectedCommitment + confidence routing) čeká.

Real-time inbox + AES-256-GCM šifrování bodyText/Html at-rest + 96denní retention
selektivní cleanup. Posledni "core infrastruktura" fáze před fází 6 (vyšumělé
závazky), která už je čistě AI/UX feature nad existující infrastrukturou.

## Co je hotové

| Komponenta | Cesta | Co dělá |
|---|---|---|
| **Retention** | `src/lib/posta-cleanup.ts` | 96denní cleanup bodyText/Html/attachments/rawHeaders |
| Retention cron | `posta-cleanup` daily 03:00 | Idempotent, transactional batches 1000 |
| Retention manual | `npm run posta:cleanup -- --confirm` | Single source of truth = sdílený lib |
| `RETENTION.md` | `docs/email-intelligence/RETENTION.md` | Co se maže, co zachová, proč 96d |
| **Full delete** | `DELETE /api/posta/emails/:id?full=true` | Hard delete + cascade chunks + audit |
| Audit log | `PostaDeletionLog` tabulka | Snapshot navždy (right to be forgotten WITH evidence) |
| **Encryption** | `src/lib/email-body-crypto.ts` | AES-256-GCM wrapper s key versioning |
| Key registry | `EncryptionKey` tabulka | Hash detekce nesouladu klíče |
| Encryption migrate | `scripts/posta-encrypt-migrate.ts` | Plain → ciphertext převod existujících dat |
| Encrypted writes | `posta-sync.ts` upsert | Encrypted ciphertext sloupce |
| Encrypted reads | `getDecryptedBodyText/Html` helper | Transparentní fallback legacy plain |
| **Gmail push** | `src/lib/gmail-watch.ts` | startWatch / stopWatch / processHistoryFromPush |
| Webhook | `src/pages/api/posta/gmail-webhook.ts` | JWT verify + fire-and-forget |
| Watch start/stop | `POST /api/integrations/google/posta-watch` | UI/curl trigger |
| Watch renewal cron | `posta-watch-renew` daily 04:00 | Auto-renew < 48h před expirací |
| Setup script | `scripts/setup-gmail-pubsub.sh` | Executable gcloud doc |
| `INFRASTRUCTURE.md` | `docs/email-intelligence/INFRASTRUCTURE.md` | Kompletní setup + monitoring |
| **Polling** | `posta-sync` cron 15→**30 min** | Záchranná vrstva nad push |

## Migrace pro existující data

### Krok 1 — Nasaď fázi 5 (deploy)
- Push commitů + GitHub Actions build + Synology pull
- Migrace `add_posta_resolve_and_digest`, `add_posta_embed`, `add_posta_deletion_log`,
  `add_posta_encryption`, `add_posta_watch` se aplikují při startu container

### Krok 2 — Vygeneruj encryption key
```bash
openssl rand -hex 32
# výstup: např. a1b2c3...64 hex chars
```

Doplň do `.env` na Synology:
```
EMAIL_BODY_ENCRYPTION_KEY=<výstup z openssl>
```

Reload container: `sudo docker compose up -d --force-recreate app`

### Krok 3 — Migrace existujícího bodyText do ciphertext
```bash
ssh root@SPIZ
cd /volume1/docker/raseliniste
sudo docker compose exec app npm run posta:encrypt-migrate -- --dry-run   # spocita
sudo docker compose exec app npm run posta:encrypt-migrate -- --confirm   # spusti
```

Batchuje po 500, ~2-5 min pro 10K mailů. Idempotent — druhý run skip.

### Krok 4 — GCP Pub/Sub setup
Spusť **`./scripts/setup-gmail-pubsub.sh`** lokálně (vyžaduje `gcloud` CLI auth)
NEBO manuálně v GCP Console krok-po-kroku per `docs/email-intelligence/INFRASTRUCTURE.md`.

Vrátí ti env vars:
```
GMAIL_PUBSUB_TOPIC=projects/raseliniste-prod/topics/gmail-watch-petr
GMAIL_PUBSUB_AUDIENCE=https://www.raseliniste.cz/api/posta/gmail-webhook
GMAIL_PUBSUB_SA_EMAIL=gmail-push-sa@raseliniste-prod.iam.gserviceaccount.com
```

Doplň do `.env` + reload container.

### Krok 5 — Spustit watch
```bash
curl -X POST https://www.raseliniste.cz/api/integrations/google/posta-watch \
  -H "Cookie: <session>" \
  -H "content-type: application/json" \
  -d '{"action":"start"}'
```

Nebo budoucí UI tlačítko (TODO — `PostaIntegration.tsx` ještě nemá).

### Krok 6 — Test
Pošli si testovací mail → sleduj logy:
```bash
sudo docker compose logs app -f --tail 50 | grep -E "gmail-webhook|gmail-push"
```

Měl bys vidět `[gmail-push] userId=... imported=1` do **5-30 sekund** od příchodu.

## Architektura — zhuštěné

```
Real-time flow (faze 5):
[Mail příchod] → Gmail → Pub/Sub topic → webhook (~5-30s end-to-end)
                                          → JWT verify
                                          → fire-and-forget history.list + insert
                                          → encrypted bodyText/Html storage

Záchranná polling (faze 5 30min):
[Cron posta-sync 30 min] → users.messages.list?q=newer_than:1d → upsert

Klasifikace (faze 2):
[Cron posta-classify 15 min] → SELECT WHERE classification IS NULL
                                → Gemini Flash → EmailClassification

Embedding (faze 4):
[Cron posta-embed 5 min] → SELECT WHERE embeddedAt IS NULL AND classification != NULL
                            → chunking → embedTextsBatch concurrency 5
                            → RagChunk pgvector HNSW

Digest (faze 3):
[Cron posta-digest daily 7:00] → topActions+escalations+summary → EmailDigest

Retention (faze 5):
[Cron posta-cleanup daily 03:00] → SELECT WHERE receivedAt < cutoff AND bodyDeletedAt IS NULL
                                    → batches 1000 nuluj body fields → bodyDeletedAt = now

Watch renewal (faze 5):
[Cron posta-watch-renew daily 04:00] → users WHERE gmailWatchExpiresAt < now+48h
                                        → startWatch (Gmail prodlouzi 7d)
```

## Cron joby — kompletní seznam

| Job | Schedule | Fáze | Účel |
|---|---|---|---|
| `posta-sync` | every 30 min | 1 → fáze 5 | Polling záchranná vrstva nad push |
| `posta-classify` | every 15 min | 2 | Klasifikace unclassified mailů |
| `posta-embed` | every 5 min | 4 | RAG chunking + embeddings |
| `posta-digest` | daily 7:00 | 3 | Daily digest snapshot |
| `posta-cleanup` | daily 3:00 | 5 | 96d retention bodyText cleanup |
| `posta-watch-renew` | daily 4:00 | 5 | Gmail watch lifetime prodloužení |

## Šifrování — důsledky

### Co JE šifrované (AES-256-GCM):
- `EmailMessage.bodyTextCiphertext`
- `EmailMessage.bodyHtmlCiphertext`

### Co NENÍ šifrované (záměrně — pro filtering/search):
- `subject`, `snippet` (Gmail-generated preview ~150 chars)
- `fromAddress`, `fromName`, `toAddresses`, `ccAddresses`, `bccAddresses`
- `labels`, `receivedAt`, `gmailMessageId`, `threadId`
- `RagChunk.text` — komprimovaný plain text chunků pro ILIKE search

Důvod: chunks už **jsou** komprimovaná verze body (typicky < 500 tok), šifrování
by zlomilo ILIKE substring search a vyžádalo decrypt + scan na každý query.
Trade-off: chunks v plaintextu, originální `bodyText/Html` šifrované —
útočník s DB read může vyčíst chunks (~25 % bodu), ne plný body.

### Klíč
- `EMAIL_BODY_ENCRYPTION_KEY` v env, 32 bytes hex
- **NE sdílí** se `SESSION_SECRET` (kompromitace sessions != bodies)
- `EncryptionKey` v DB drží `keyId` + SHA-256 hash klíče (NIKDY plain key)
- Hash mismatch při startu = throw (detekce nesouladu env)

### Rotace (future)
- Schema podporuje `keyId` + `retiredAt` (multi-key decrypt)
- Wrapper aktuálně podporuje jen `env:current` — rotace = budoucí PR
  (přidat env `EMAIL_BODY_ENCRYPTION_KEY_v1`, ..., `decryptBody` zkusí
   v pořadí current → v1 → v2)

## Retention — důsledky

### Po 96 dnech od `receivedAt`:
- **MAZÁNO** (set null): `bodyText`, `bodyHtml`, `bodyTextCiphertext`,
  `bodyHtmlCiphertext`, `attachments`, `rawHeaders`
- **ZACHOVÁNO**: subject, from/to/cc, snippet, labels, classification,
  chunks (text + embeddings), digest, audit
- `bodyDeletedAt` audit timestamp

Petr po 96 dnech vidí:
- V `/posta` kartě — všechny metadata + LLM reason + suggestedAction
  + chunks-driven search funguje
- "Otevřít v Gmailu" — Gmail má vlastní retention (typicky bez limitu),
  body je tam pořád
- Vyhledávání: chunks.text pokrývá body, ILIKE + vector search funguje

### Full delete (Petr-iniciovaný)
- `DELETE /api/posta/emails/:id?full=true` → vše pryč + audit log
  v `PostaDeletionLog` (snapshot zachován navždy)

## Známé limity fáze 5

1. **UI tlačítko `Spustit push` chybí v `PostaIntegration.tsx`** — Petr
   musí curl ručně nebo zavolat endpoint. Triviální dopnit (TODO faze 5+).
2. **Žádný health endpoint** `/api/health/posta-push` — pro external
   monitoring by se hodil. Petr může v `/settings/crons` vidět
   `posta-watch-renew` last run jako proxy.
3. **`PostaIntegration` UI nezobrazuje watch status** — gmailWatchExpiresAt
   + gmailLastPushAt by se hodily v dashboardu. TODO.
4. **Encryption migrate skript musí běžet ručně** po deploy — automatický
   migrace v container startup je risky (pomalá DB, chyby = container loop).
   Petr to musí spustit jednorázově.
5. **Hash mismatch při rotaci klíče v `EncryptionKey`** — pokud Petr
   přepíše `EMAIL_BODY_ENCRYPTION_KEY` v env bez rotace přes nový keyId,
   wrapper throw při ensureEncryptionKeyRegistered. Petr to uvidí jako
   error v posta-sync logu.

## 3 nezodpovězené otázky blokující fázi 6 (DetectedCommitment)

### 1. Embedding-based deduplication komitmentů?

LLM v fáze 6 detekuje "slíbil jsi odpovědět do pátku" v každém klasifikovaném
mailu. **Pokud Petr posílá podobné maily víc klientům**, vznikne N podobných
záznamů `DetectedCommitment`.

- **(a)** Žádná deduplikace — každý mail = vlastní commitment. Plus: jednodušší.
  Minus: Petr v UI vidí 5 stejných úkolů "odpovědět X o Y".
- **(b)** Cosine similarity nad `proposedTaskTitle` embedding při insertu;
  pokud > 0.9 s existujícím `pending`, skip. Plus: clean UI. Minus: false
  positives (různé subjekty, podobné formulace).
- **(c)** Group by `quotedText` exact match. Plus: deterministické. Minus:
  jen literal duplicates.

Doporučení: **(a)** pro fázi 6 MVP, **(b)** pokud Petr po měsíci skutečně
narazí.

### 2. Reklasifikace confidence po rejected feedback?

Petr odmítne 50 detected commitments → manuální revize promptu per
`POSTA-DESIGN-DECISIONS.md`. **Co s historickými `DetectedCommitment`
záznamy?**

- **(a)** Vše ponechat — Petr vidí "rejected by user" zůstává.
- **(b)** Auto-reklasifikovat rejected záznamy s novým promptem (background
  cron). Plus: pokud nový prompt už by `rejected` markem nevytvořil, vyhodit.
  Minus: bias (přizpůsobíme prompt past Petrovým preferences, ztratíme
  původní detection rate).
- **(c)** Vytvořit `DetectedCommitment` nový pro každý mail, starý nechat
  s historií. Plus: full audit. Minus: 2× data.

Doporučení: **(a)** + jednoduchý dashboard `/settings/posta-classifier` co
ukáže precision/recall metrics. Petr se rozhodne při manuální revizi.

### 3. Odhlášené závazky — pasivní expirace?

Pokud Petr **ignoruje** detected commitment (ne accept, ne reject) > 30 dnů,
co se má stát?

- **(a)** Nic — zůstane v `pending` navždy. Plus: explicit decision required.
  Minus: kupí se v UI.
- **(b)** Auto-archive po N dnech bez akce. Plus: clean UI. Minus: ztratíme
  feedback signal pro prompt revizi.
- **(c)** Po N dnech přesunout do "stale" tab v UI. Petr může promazat
  hromadně. Plus: kompromis. Minus: UX komplexita.

Doporučení: **(c)** s N = 30 dnů. Petr v UI uvidí 2 tabs: "Čeká rozhodnutí"
+ "Zastaralé (auto-archive za N dnů)".
