# GoSMS — operativní návod

> Modul přidán **2026-05-10**. Univerzální SMS brána použitelná napříč Rašeliništěm
> (připomínky úkolů, notifikace klientům, ad-hoc SMS, později i 2FA fallback,
> birthday reminders apod.).
>
> Spec API: <https://doc.gosms.eu/?lang=cs>

## 1) Setup credentials

1. Přihlas se do **<https://app.gosms.eu/>** → **Samoobsluha → API**
   <https://app.gosms.eu/selfservice/api/>
2. Zkopíruj `client_id` a `client_secret`
3. V Rašeliništi otevři **Nastavení → Integrace** → blok **GoSMS**
4. Vlož obě hodnoty → **Uložit & otestovat**
   - Pokud OK, blok ukáže aktuální kredit + dropdown s kanály
   - Pokud chyba, koukni na text — typicky špatné credentials nebo neaktivní GoSMS účet

## 2) Default kanál

V dropdownu **Výchozí kanál pro odesílání** vyber kanál co se použije, kdykoli kód
nezadá vlastní `channel`. Pro single-channel účty (jeden kanál) je předvyplněný.

## 3) Webhooky (instant doručenky + odpovědi)

Po uložení credentials se automaticky vygeneruje **webhookSecret** (24-byte
base64url). UI zobrazí dvě URL:

- **Doručenky:** `https://www.raseliniste.cz/api/webhooks/gosms/delivery?token=<secret>`
- **Odpovědi:**  `https://www.raseliniste.cz/api/webhooks/gosms/reply?token=<secret>`

Obě nakonfiguruj v **GoSMS samoobsluze → Webhooky** (delivery + reply zvlášť).

**Bez webhooků** funguje vše stále — fallback polling cron `poll-sms-status`
běží každých 30 min a doptává se na status zpráv posledních 24 h. Webhooky jen
zrychlují feedback (instant místo až 30 min) a přidávají možnost zachytit
odpovědi (replies polling není automatický).

### Jak ověřit že webhooky chodí

Po prvním poslání SMS se počkej cca 30 sekund, pak v `/settings/integrations`
v bloku **Historie SMS** klikni Refresh. Pokud webhook funguje, status se změnil
na **doručeno** s časovým razítkem ze zelené pilulky. Pokud zůstává na *odesláno*,
webhook nedorazil — počkej do dalšího pollingu (30 min) nebo zkontroluj v GoSMS
samoobsluze logy webhook callů.

### Regenerace secretu

Pokud webhookSecret leakne (např. omylem v logu), klikni **Regenerovat secret**.
Nová URL — musíš ji aktualizovat v GoSMS samoobsluze, jinak doručenky přestanou
chodit (polling fallback ale stále funguje).

## 4) Posílání SMS

### Z UI (ad-hoc)

`/settings/integrations` → **Historie SMS** → **Poslat SMS**. Vlož číslo +
text. Default kanál se použije automaticky.

### Z kódu (interní helper)

```ts
import { sendUserSms } from "@/lib/sms-send";

const result = await sendUserSms(userId, {
  to: "+420 777 123 456",      // nebo pole, normalizujeme E.164
  message: "Připomínka úkolu: zaplatit fakturu",
  linkedEntity: { type: "task", id: task.id },
  // volitelné: channel, scheduledFor, pinned
});

if (!result.ok) {
  console.error("SMS selhala:", result.error);
  // SmsMessage row už existuje se status=failed + errorMessage
}
```

`sendUserSms` vždy vytvoří `SmsMessage` row v DB **před** API callem (audit
trail i v případě selhání). Po úspěchu `status="sent"`, po doručence `delivered`.

### Z REST API (jiný klient v rámci Rašeliniště)

```bash
curl -X POST https://www.raseliniste.cz/api/sms/send \
  -H "content-type: application/json" \
  -H "Cookie: <session>" \
  -d '{"to":"+420777123456","message":"Test","linkedEntity":{"type":"ad-hoc"}}'
```

## 5) Audit & cleanup

- **`SmsMessage`** log — historie všech odeslaných SMS s recipients, status,
  cost, deliveryDetails. **90denní cleanup cron** (`cleanup-sms` denně 03:30)
  smaže staré záznamy mimo `isPinned`. Pinned zprávy zůstávají natrvalo.
- **`SmsReply`** log — příchozí odpovědi (z webhooku). Smaže se s rodičovskou
  zprávou, nebo když je orphan a starší 90 dní.
- **`UserIntegration.lastError`** — poslední chyba z GoSMS API, viditelná
  v UI bloku.

## 6) Cron joby

| Job | Schedule | Co dělá |
|---|---|---|
| `poll-sms-status` | every 30 min | Doptává GoSMS na status SMS posledních 24 h (fallback proti webhookům) |
| `cleanup-sms` | denně 03:30 | Mazání `SmsMessage` starších 90 dní (mimo isPinned) + osiřelých replies |

Oba běží přes interní dispatcher (`/api/cron/scheduler` z DSM Task Scheduleru).

## 7) Linked entity

Každá `SmsMessage` může mít `linkedEntity` JSON `{type, id?, label?}`:

| type | Popis |
|---|---|
| `task` | SMS k úkolu (např. připomínka 1 den předem) |
| `contact` | SMS kontaktu (manuální, birthday) |
| `recording` | SMS z workflow Studánky (např. host upozornění) |
| `birthday` | Birthday reminder SMS |
| `booking` | Booking workflow notifikace |
| `ad-hoc` | Ručně z UI |

Pole je **flexibilní** (žádné FK) — sirotčí odkaz po smazání úkolu zůstane v logu.
Nový typ se přidá bez migrace.

## 8) Bezpečnostní poznámky

- `client_secret` je v DB šifrován (AES-256-GCM, klíč z SESSION_SECRET) v
  `UserIntegration.tokenEnc/Iv/Tag`
- `client_id` je v `config.clientId` plain (není to skutečné secret, samoobsluha
  ho ukazuje vedle public údajů)
- `webhookSecret` je v `config.webhookSecret` plain — slouží k validaci
  příchozích webhooků (192-bit random)
- Webhook endpointy jsou `public` v `middleware.ts` (autorizace přes secret
  v query stringu, ne přes session cookie)
- `RoutingAuditLog` typu pattern pro budoucnost — kdybychom chtěli auditovat
  routing SMS reminders (zatím nepoužito)

## 9) Známé limity

- **Rate limit GoSMS:** spec ho neuvádí. Pokud bys narazil, log v `errorMessage`.
- **Žádné replies polling cronem** — pouze přes webhook. Pokud chceš replies
  bez webhooku, mimo nahodilé volání `getReplies(userId, creds, gosmsMessageId)`.
- **Single-user** v praxi — `authorizeWebhook` projde všechny `gosms` integrace
  a srovná token. Při škálování přidat indexovaný column `webhookSecretPlain`.
- **Cena SMS** se v DB ukládá jen pokud ji GoSMS vrátí — momentálně se to z API
  nedoptáváme (do budoucna lze přes GET `/v1/messages/{id}` rozšířit detail).
