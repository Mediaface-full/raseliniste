# Integrace Studánka → SRO Manager

> Kompletní instrukce pro napojení SRO Manageru na Studánku (Rašeliniště).
> Rašeliniště strana je hotová (commit 2026-07-06). Tento dokument předej
> Claude session v repu SRO Manageru — obsahuje vše pro implementaci
> přijímací strany.

## Co integrace umí

1. **Push (webhook)** — Studánka po dokončení přepisu nahrávky POSTne JSON
   na endpoint SRO Manageru. Real-time, do minuty od nahrání.
2. **Pull (export API)** — SRO Manager si může kdykoli stáhnout historii
   přepisů per klient (backfill, karta klienta).

Párování: každý Studánka projekt má pole **externalClientRef** = ID/slug
klienta v SRO Manageru. Vyplňuje Gideon ručně v nastavení projektu.

---

## ČÁST A — co nastaví Gideon v Rašeliništi

### 1. Env var (jen pro pull API)

Na Synology do `.env` + docker-compose už má řádek:

```
STUDANKA_EXPORT_TOKEN=<openssl rand -hex 24>
```

Po přidání: DSM Stop → Build → Start.

### 2. Nastavení projektu (per studánka)

V PATCH `/api/studna/<id>` (nebo přes UI až bude) tři pole:

| Pole | Hodnota | Příklad |
|---|---|---|
| `externalClientRef` | ID/slug klienta v SRO Manageru | `firma-novak-sro` nebo `42` |
| `webhookUrl` | endpoint SRO Manageru | `https://sro.example.cz/api/webhooks/studanka` |
| `webhookSecret` | sdílený secret pro HMAC podpis | `openssl rand -hex 24` |

Dokud UI pole neexistuje, jde to curl em (přihlášená session cookie) nebo mi
Gideon řekne a doplním UI sekci do StudnaDetail.

---

## ČÁST B — co implementovat v SRO Manageru

SRO Manager stack: **FastAPI + SQLAlchemy (async) + asyncpg + Alembic**
(ověřeno 2026-07-06 z `backend/requirements.txt`). Postgres.

### 1. DB tabulka (Alembic migrace)

```python
# alembic revision: studanka_recordings
op.create_table(
    "studanka_recordings",
    sa.Column("id", sa.String(40), primary_key=True),        # recordingId z Rašeliniště (cuid)
    sa.Column("client_ref", sa.String(120), nullable=False), # párování na klienta
    sa.Column("project_id", sa.String(40), nullable=False),
    sa.Column("project_name", sa.String(200), nullable=False),
    sa.Column("recording_type", sa.String(20), nullable=False),  # STANDARD | BRIEF | UPLOAD
    sa.Column("guest_name", sa.String(200), nullable=True),
    sa.Column("duration_sec", sa.Integer, nullable=True),
    sa.Column("transcript", sa.Text, nullable=False),
    sa.Column("summary", sa.Text, nullable=True),            # AI shrnutí (UPLOAD nemá)
    sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)
op.create_index("ix_studanka_client", "studanka_recordings", ["client_ref"])
op.create_index("ix_studanka_recorded", "studanka_recordings", ["recorded_at"])
```

`id` jako primary key = přirozená idempotence (Rašeliniště může webhook
retry-nout 3× → Postgres `INSERT ... ON CONFLICT (id) DO UPDATE`).

Párování `client_ref` ↔ klient: doporučeně použít existující ID klienta
v SRO Manageru (int/uuid jako string) — Gideon ho vyplní do studánky.

### 2. Webhook endpoint (přijímací)

`POST /api/webhooks/studanka`

**Payload který přijde:**

```json
{
  "event": "recording.processed",
  "projectId": "cmc3x…",
  "projectName": "Stavba Novák",
  "clientRef": "firma-novak-sro",
  "recordingId": "cmc9y…",
  "recordingType": "STANDARD",
  "guestName": "Karel",
  "durationSec": 1840,
  "transcript": "…celý přepis…",
  "summary": "…AI shrnutí nebo null…",
  "createdAt": "2026-07-06T09:12:00.000Z",
  "processedAt": "2026-07-06T09:14:33.000Z"
}
```

**Ověření podpisu (POVINNÉ):** hlavička `X-Raseliniste-Signature`
obsahuje `sha256=<hex HMAC-SHA256 raw body přes webhookSecret>`.

```python
# FastAPI router — backend/app/routers/studanka_webhook.py
import hashlib, hmac
from datetime import datetime
from fastapi import APIRouter, Request, Response
from sqlalchemy.dialects.postgresql import insert as pg_insert

router = APIRouter()

@router.post("/api/webhooks/studanka")
async def studanka_webhook(request: Request):
    raw_body = await request.body()  # RAW bytes — podpis se počítá z nich
    signature = request.headers.get("x-raseliniste-signature", "")

    secret = settings.STUDANKA_WEBHOOK_SECRET  # stejný jako v Rašeliništi
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return Response(status_code=401)

    data = await request.json()
    if data.get("event") != "recording.processed":
        return Response(status_code=200)  # neznámý event — ack a ignoruj

    # Idempotentní upsert — Rašeliniště může retry-nout 3×
    stmt = pg_insert(StudankaRecording).values(
        id=data["recordingId"],
        client_ref=data.get("clientRef") or "",
        project_id=data["projectId"],
        project_name=data["projectName"],
        recording_type=data["recordingType"],
        guest_name=data.get("guestName"),
        duration_sec=data.get("durationSec"),
        transcript=data["transcript"],
        summary=data.get("summary"),
        recorded_at=datetime.fromisoformat(data["createdAt"].replace("Z", "+00:00")),
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={"transcript": data["transcript"], "summary": data.get("summary")},
    )
    async with async_session() as session:
        await session.execute(stmt)
        await session.commit()

    return Response(status_code=200)
```

**Důležité:**
- Vrátit **200 do 15 s**, jinak Rašeliniště retry-ne (2 s, pak 10 s backoff).
- `hmac.compare_digest()` proti timing attackům, ne `==`.
- Podpis se počítá z **raw body bytes** (`await request.body()`) — žádný
  re-encode JSON před ověřením.
- `clientRef` může být null (projekt bez párování) — rozhodni se: uložit
  s prázdným ref, nebo 200 + ignorovat.
- Endpoint musí být **mimo session/CSRF auth** SRO Manageru (webhook nemá
  cookie) — zkontrolovat `auth.py` + `csrf.py` middleware exempty.

### 3. UI v SRO Manageru

Na kartě klienta záložka/sekce „Studánka" — SELECT z `studanka_recordings
WHERE client_ref = ?` ORDER BY recorded_at DESC. Zobrazit: datum, kdo
(guest_name), délka, summary (collapse pro celý transcript).

### 4. Volitelný backfill přes pull API

Jednorázový import historie (nebo periodická pojistka kdyby webhook vypadl):

```
GET https://www.raseliniste.cz/api/export/studanka?client=firma-novak-sro&since=2026-01-01&limit=200
Authorization: Bearer <STUDANKA_EXPORT_TOKEN>
```

Response: `{ ok: true, count: N, items: [ …stejná pole jako webhook… ] }`.
Bez `client` param vrátí záznamy VŠECH spárovaných projektů (initial sync).
Stránkování: `limit` max 200; pro víc iterovat přes `since` (poslední
createdAt z předchozí dávky).

Stejný upsert do `studanka_recordings` jako u webhooku.

### 5. Env vars v SRO Manageru

```
STUDANKA_WEBHOOK_SECRET=<stejná hodnota jako webhookSecret v Rašeliništi>
STUDANKA_EXPORT_TOKEN=<stejná hodnota jako v Rašeliništi .env>
STUDANKA_EXPORT_URL=https://www.raseliniste.cz/api/export/studanka
```

---

## Postup nasazení (checklist)

1. ☐ SRO Manager: tabulka + webhook endpoint + env vars → deploy
2. ☐ Rašeliniště: `STUDANKA_EXPORT_TOKEN` do .env na Synology → Stop/Build/Start
3. ☐ Gideon: v nastavení každé klientské studánky vyplnit
   webhookUrl + webhookSecret + externalClientRef
4. ☐ Test: nahrát testovací hlasovku do spárované studánky → do minuty
   se objeví řádek v `studanka_recordings`
5. ☐ Backfill: jednorázový pull pro historická data
6. ☐ SRO Manager UI: sekce Studánka na kartě klienta

## Bezpečnostní poznámky

- Webhook secret a export token jsou **různé věci**: secret podepisuje
  push (per projekt), token autorizuje pull (globální).
- Přepisy můžou obsahovat citlivé informace klientů — v SRO Manageru
  zvážit přístupová práva (kdo z týmu vidí přepisy).
- Rašeliniště export API vydává jen projekty s vyplněným
  externalClientRef — nespárované studánky ven nejdou nikdy.
