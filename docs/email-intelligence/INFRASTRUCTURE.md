# Pošta — infrastruktura

> Stav 2026-05-12, fáze 5. Popisuje GCP setup pro Gmail push, Pub/Sub topic,
> service accounty, watch renewal lifecycle, a flow nového mailu od příchodu
> v Gmailu po klasifikaci v Rašeliništi.
>
> **Cíl tohoto dokumentu:** za rok pochopit setup zpětně bez memory dives.

## High-level flow

```
[Nový mail přijde do Petrova Gmailu]
        ↓
[Gmail → Pub/Sub topic gmail-watch-petr]
   gmail-api-push@system.gserviceaccount.com → publish
        ↓
[Pub/Sub topic + push subscription]
   OIDC-signed POST to webhook
        ↓
[POST https://www.raseliniste.cz/api/posta/gmail-webhook]
   1. Verify JWT (audience + issuer + SA email)
   2. Parse Pub/Sub envelope → { emailAddress, historyId }
   3. Najdi User s active watch
   4. Vrať 200 OK (do 10s, Pub/Sub jinak retryuje)
   5. Fire-and-forget: processHistoryFromPush(userId)
        ↓
[gmail-watch.ts processHistoryFromPush]
   - gmail.users.history.list(startHistoryId=user.gmailHistoryId)
   - Pro každý messagesAdded → getMessage + parseGmailMessage
   - Upsert EmailMessage (encrypted bodyText/Html pokud klíč v env)
   - UPDATE User SET gmailHistoryId = new, gmailLastPushAt = now()
        ↓
[Existující pipeline klasifikace + embed]
   - posta-classify cron 15 min → EmailClassification
   - posta-embed cron 5 min → RagChunk + embeddings
   - posta-digest daily 7:00 → EmailDigest
        ↓
[Petr otevře /posta]
   - Vidí nový mail s klasifikací do **~5-30 sekund** od příchodu
```

## Komponenty

### GCP — Cloud Pub/Sub

| Resource | Hodnota | Účel |
|---|---|---|
| **Project** | `raseliniste-prod` (Petrův GCP projekt) | host |
| **Topic** | `projects/raseliniste-prod/topics/gmail-watch-petr` | Gmail sem publishuje |
| **Subscription** | `gmail-push-to-raseliniste` | Push → webhook |
| **Service account** | `gmail-push-sa@raseliniste-prod.iam.gserviceaccount.com` | Podepisuje OIDC JWT v push requestech |
| **Google publisher SA** | `gmail-api-push@system.gserviceaccount.com` | Google-owned, dostává `roles/pubsub.publisher` na topic |

### Aplikace — Rašeliniště

| Komponenta | Cesta | Účel |
|---|---|---|
| Watch lib | `src/lib/gmail-watch.ts` | `startWatch`, `stopWatch`, `processHistoryFromPush` |
| Webhook | `src/pages/api/posta/gmail-webhook.ts` | JWT verify + fire-and-forget processing |
| Watch start/stop API | `POST /api/integrations/google/posta-watch` | UI tlačítko `{action: "start"|"stop"}` |
| Renewal cron | `posta-watch-renew` daily 04:00 | Prodlouží watch s expirací < 48h |
| Setup script | `scripts/setup-gmail-pubsub.sh` | Executable dokumentace všech gcloud příkazů |

### DB

| Tabulka/sloupec | Účel |
|---|---|
| `User.gmailWatchTopicName` | Sledování že watch je aktivní (full topic name string) |
| `User.gmailWatchExpiresAt` | Cron renewal threshold (< 48h → renew) |
| `User.gmailLastPushAt` | Audit, "kdy přišel poslední push" pro detekci ztracených |
| `User.gmailHistoryId` | Cursor pro `users.history.list` (sdílený s fází 1) |

### Env vars

```
GMAIL_PUBSUB_TOPIC=projects/raseliniste-prod/topics/gmail-watch-petr
GMAIL_PUBSUB_AUDIENCE=https://www.raseliniste.cz/api/posta/gmail-webhook
GMAIL_PUBSUB_SA_EMAIL=gmail-push-sa@raseliniste-prod.iam.gserviceaccount.com
EMAIL_BODY_ENCRYPTION_KEY=<64 hex chars>   # AES-256-GCM klíč (fáze 5)
```

## Setup proces (jednorázový)

### 1) GCP setup
Spusť **`./scripts/setup-gmail-pubsub.sh`** (vyžaduje `gcloud` CLI auth
k Petrově GCP projektu).

Pokud Petr `gcloud` nemá, manuálně v GCP Console:
1. **APIs & Services → Enable APIs** → Cloud Pub/Sub API
2. **Pub/Sub → Topics → Create** `gmail-watch-petr`
3. **Pub/Sub → Topics → gmail-watch-petr → Permissions → Add**:
   - Member: `gmail-api-push@system.gserviceaccount.com`
   - Role: `Pub/Sub Publisher`
4. **IAM → Service Accounts → Create**:
   - Name: `gmail-push-sa`
   - Display: "Gmail Push SA pro Rašeliniště"
5. **IAM → grant projektový level**:
   - Member: `service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com`
   - Role: `Service Account Token Creator`
6. **Pub/Sub → Subscriptions → Create**:
   - Topic: `gmail-watch-petr`
   - Delivery type: **Push**
   - Endpoint URL: `https://www.raseliniste.cz/api/posta/gmail-webhook`
   - Enable authentication: ✓
   - Service account: `gmail-push-sa@...`
   - Audience: `https://www.raseliniste.cz/api/posta/gmail-webhook`
   - Ack deadline: 30s
   - Message retention: 1 day

### 2) Rašeliniště env
Doplnit na Synology container `.env`:
```
GMAIL_PUBSUB_TOPIC=projects/raseliniste-prod/topics/gmail-watch-petr
GMAIL_PUBSUB_AUDIENCE=https://www.raseliniste.cz/api/posta/gmail-webhook
GMAIL_PUBSUB_SA_EMAIL=gmail-push-sa@raseliniste-prod.iam.gserviceaccount.com
EMAIL_BODY_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Pak: `docker compose up -d --force-recreate app` (reload env).

### 3) Spustit watch v UI
1. Otevři `/settings/integrations/google`
2. **GoSMS karta** (zatím — fáze 5 UI tlačítko TODO) — zavoláš
   ručně:
   ```bash
   curl -X POST https://www.raseliniste.cz/api/integrations/google/posta-watch \
     -H "Cookie: session=..." \
     -H "content-type: application/json" \
     -d '{"action":"start"}'
   ```
3. Watch je aktivní 7 dnů. Cron `posta-watch-renew` udrží naživu.

### 4) Otestování
Pošli si testovací mail do Petrova Gmailu. Sleduj:
```bash
ssh root@SPIZ
cd /volume1/docker/raseliniste
sudo docker compose logs app -f --tail 50 | grep -E "gmail-webhook|gmail-push"
```

Měl bys vidět:
```
[gmail-push] userId=... imported=1 errors=0 newHistoryId=...
```

V DB:
```sql
SELECT "gmailMessageId", "subject", "fromAddress", "receivedAt", "importedAt"
FROM "EmailMessage"
ORDER BY "importedAt" DESC LIMIT 5;
```

## Bezpečnost — JWT verifikace

Pub/Sub push requesty obsahují `Authorization: Bearer <jwt>` header.
JWT je podepsaný `gmail-push-sa@...` service accountem.

Webhook handler v `src/pages/api/posta/gmail-webhook.ts` ověřuje:

1. **Signature** přes Google public keys (`google-auth-library` `verifyIdToken`)
2. **Audience** (`aud` claim) == `GMAIL_PUBSUB_AUDIENCE`
3. **Issuer** (`iss` claim) == `https://accounts.google.com`
4. **Email** (`email` claim) == `GMAIL_PUBSUB_SA_EMAIL`
5. **email_verified** == true

Pokud cokoli selže → **401** (Pub/Sub se zastaví retryovat po několika
failures, Petr to uvidí jako "delivery failures" v GCP Console).

## Watch lifecycle

```
[Setup]
   ↓ POST /api/integrations/google/posta-watch action=start
[Active watch — 7 dnů]
   ↓ Gmail pushuje notifikace každý new mail
   ↓ cron posta-watch-renew daily 04:00 detekuje expirace < 48h
[Renewal — startWatch znovu]
   ↓ Gmail vrátí nový expiration, žádný downtime
[...repeat 7 dnů cyklus...]
```

**Pokud renewal selže:**
1. Cron logy `[posta-watch-renew] FAILED` → Petr to uvidí v `/settings/crons`
2. Po expirace push přestane → fallback polling `posta-sync` cron každých
   30 min stejně chytí nové maily (pouze s 30 min delay místo 5-30s)
3. Petr ručně klikne `Spustit push` znovu

## Záchranné mechanismy

### 1) Polling fallback
Cron `posta-sync` (30 min interval, fáze 5+) — pokud Pub/Sub spadne nebo
watch expiruje, polling chytí ztracené maily. Per Petrovo zadání:
*"Nezrušit polling úplně — Pub/Sub má edge case delivery failures."*

### 2) `gmailLastPushAt` health check
Aplikace si pamatuje kdy přišel poslední push. Pokud > 30 min bez push +
Petr má active watch → indikátor problému (UI warning, future work).

### 3) Pub/Sub dead letter
Pokud webhook vrací 5xx víc než N×, Pub/Sub zastaví delivery (failure
threshold v subscription settings). Manuální resume přes GCP Console.

### 4) Idempotence
Webhook může dostat **duplicit push** pro stejnou history change. Naše
upsert pres `gmailMessageId @unique` toleruje — second insert = no-op.

## Cost

GCP Pub/Sub free tier:
- 10 GB / měsíc message delivery
- 10K subscriptions / topics

Petrův mail volume ~600 mailů/měs × 1KB push payload = **0.6 MB/měs**
→ daleko pod free tier. **Náklad: 0 USD.**

## Monitoring

V `/settings/crons` (existující page):
- `posta-watch-renew` status (last run, error)

V `/settings/integrations/google` (PostaIntegration karta — pokud rozšířena):
- Watch status (active/expired)
- gmailLastPushAt timestamp
- Last 24h push count

V Pub/Sub Console:
- Subscription metrics → delivery rate, ack rate, oldest unacked
- Pokud "oldest unacked > 5 min" = webhook problém

## Změny v budoucnu

- **Multi-user**: per-user topic (`gmail-watch-<userId>`) místo single topic.
  Pro single-user instance zbytečné, ale pokud Petr později přidá tým.
- **Filtering**: aktuálně dostáváme push pro INBOX label. Mohli bychom filtrovat
  i Drafts/Sent (jen INBOX label v `users.watch()` labelIds). Future work.
- **Health endpoint**: `/api/health/posta-push` co vrátí
  `{ watchActive, lastPushAt, ageMs }` pro external monitoring.
