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

SRO Manager stack: PHP 8.3 + Slim 4 + MariaDB (standardní Mediaface stack).

### 1. DB tabulka

```sql
CREATE TABLE studanka_recordings (
  id            VARCHAR(40) PRIMARY KEY,      -- recordingId z Rašeliniště (cuid)
  client_ref    VARCHAR(120) NOT NULL,        -- párování na klienta
  project_id    VARCHAR(40) NOT NULL,
  project_name  VARCHAR(200) NOT NULL,
  recording_type VARCHAR(20) NOT NULL,        -- STANDARD | BRIEF | UPLOAD
  guest_name    VARCHAR(200) NULL,
  duration_sec  INT NULL,
  transcript    MEDIUMTEXT NOT NULL,
  summary       TEXT NULL,                    -- AI shrnutí (UPLOAD nemá)
  recorded_at   DATETIME NOT NULL,            -- createdAt z payloadu
  received_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_ref),
  INDEX idx_recorded (recorded_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_czech_ci;
```

`id` jako primary key = přirozená idempotence (Rašeliniště může webhook
retry-nout 3×, `INSERT ... ON DUPLICATE KEY UPDATE` to vyřeší).

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

```php
// Slim 4 route handler
$app->post('/api/webhooks/studanka', function (Request $request, Response $response) {
    $rawBody = (string) $request->getBody();
    $signature = $request->getHeaderLine('X-Raseliniste-Signature');

    $secret = $_ENV['STUDANKA_WEBHOOK_SECRET']; // stejný jako v Rašeliništi
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);

    if (!hash_equals($expected, $signature)) {
        return $response->withStatus(401);
    }

    $data = json_decode($rawBody, true);
    if (($data['event'] ?? '') !== 'recording.processed') {
        return $response->withStatus(200); // neznámý event typ — ack a ignoruj
    }

    // Idempotentní upsert — Rašeliniště může retry-nout
    $stmt = $this->get(PDO::class)->prepare('
        INSERT INTO studanka_recordings
          (id, client_ref, project_id, project_name, recording_type,
           guest_name, duration_sec, transcript, summary, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          transcript = VALUES(transcript), summary = VALUES(summary)
    ');
    $stmt->execute([
        $data['recordingId'],
        $data['clientRef'] ?? '',
        $data['projectId'],
        $data['projectName'],
        $data['recordingType'],
        $data['guestName'],
        $data['durationSec'],
        $data['transcript'],
        $data['summary'],
        (new DateTime($data['createdAt']))->format('Y-m-d H:i:s'),
    ]);

    return $response->withStatus(200);
});
```

**Důležité:**
- Vrátit **200 do 15 s**, jinak Rašeliniště retry-ne (2 s, pak 10 s backoff).
- `hash_equals()` proti timing attackům, ne `===`.
- Podpis se počítá z **raw body** — žádný re-encode JSON před ověřením.
- `clientRef` může být null (projekt bez párování) — rozhodni se: uložit
  s prázdným ref, nebo 200 + ignorovat.
- Endpoint musí být mimo session auth SRO Manageru (webhook nemá cookie).

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
