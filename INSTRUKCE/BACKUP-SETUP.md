# Backup setup — denní záloha na druhou Synology přes Tailscale rsync

## Co to dělá

Každý den v **2:00 ráno** (cron `backup` v `cron-schedule.ts`):

1. **pg_dump** PostgreSQL databáze → `/data/backups/db-YYYY-MM-DD.sql.gz`
2. **tar.gz** složky `uploads/` → `/data/backups/uploads-YYYY-MM-DD.tar.gz`
3. **rsync daemon** (port 873) na druhý NAS přes Tailscale, ne SSH
4. **Retention** — smaže lokální soubory starší 30 dní (`--delete` v rsync zrcadlí to i na vzdáleném)

Pokud něco selže → mail na `NOTIFICATION_EMAIL`.

## Cílový NAS (info)

- **IP**: `100.83.62.70` (Tailscale)
- **Shared folder**: `ZALOHY_APLIKACI`
- **Subpath**: `raseliniste`
- **Rsync user**: `app-raseliniste`

## Setup (jednorázově)

### 1. Na CÍLOVÉM NASu — povolit rsync daemon

DSM (https://100.83.62.70:5001) → **Control Panel** → **File Services** → **rsync** (tab):

- ☑ **Enable rsync service** (port 873 default)
- Klik **Edit rsync account** → vytvořit účet:
  - Username: `app-raseliniste`
  - Password: heslo z chatu
- Potvrdit, zavřít.

Pak **Control Panel** → **Shared Folder** → vybrat `ZALOHY_APLIKACI` → **Edit** → **Permissions** tab:
- Najdi `app-raseliniste` v "Local users"
- Nastav **Read/Write** access
- Save

A vytvoř podsložku `raseliniste`:
- **File Station** → otevřít `ZALOHY_APLIKACI` → New folder → `raseliniste`

### 2. Otestovat rsync ze zdrojového NASu

Předtím než to dáme do produkce, ověř že rsync vůbec projde. SSH na **zdrojový** NAS (kde běží raseliniste):

```bash
# Test ping přes Tailscale
ping -c 2 100.83.62.70

# Test rsync auth (--list-only nepřenáší data, jen prověří login)
RSYNC_PASSWORD='a4wVc0H3U1pUAPgaou8hxH43Jr9Z' \
  rsync --list-only app-raseliniste@100.83.62.70::ZALOHY_APLIKACI/
```

Pokud to vrátí listing složky, **OK pokračuj**. Pokud `auth failed`, zkontroluj DSM rsync user + heslo.

### 3. Doplnit env proměnné

Na zdrojovém NASu v `/volume1/docker/raseliniste/.env` přidej:

```bash
BACKUP_REMOTE_HOST=100.83.62.70
BACKUP_REMOTE_MODULE=ZALOHY_APLIKACI
BACKUP_REMOTE_PATH=raseliniste
BACKUP_REMOTE_USER=app-raseliniste
BACKUP_REMOTE_PASSWORD=a4wVc0H3U1pUAPgaou8hxH43Jr9Z
# Volitelně override default 30 dní:
# BACKUP_LOCAL_RETENTION_DAYS=30
# Healthchecks.io monitoring (krok 3b níž):
BACKUP_HEALTHCHECK_URL=https://hc-ping.com/<uuid-z-healthchecks>
```

### 3b. Healthchecks.io monitoring

Registrace na **https://healthchecks.io** (zdarma pro 20 check účtů).

1. Login → **Add Check**:
   - Name: `raseliniste-backup`
   - Period: **1 day** (každý den čekáme ping)
   - Grace Time: **1 hour** (kolik tolerance, než označí "down")
   - Save
2. Vidíš ping URL: `https://hc-ping.com/<uuid>` — zkopíruj
3. Dej do `.env` jako `BACKUP_HEALTHCHECK_URL=https://hc-ping.com/<uuid>`
4. V healthchecks.io → **Notifications** → přidej kanál:
   - Email (jednoduché)
   - Nebo Telegram/SMS/Slack
   - Ten kanál připoj k checku `raseliniste-backup`

Co tě bude notifikovat:
- **Backup neproběhl** (žádný ping za 1 den + 1 hour grace) → mail "is DOWN"
- **Backup selhal** (`/fail` ping) → mail s detailem proč
- **Backup OK** → silent (jen vidíš zelený check v dashboardu)

V healthchecks.io každý check ukazuje **historii pingů** s body textem — uvidíš tam summary backupu (pg_dump bytes, uploads bytes, rsync output) i bez otevírání mailu.

⚠️ **Bezpečnost**: heslo je v `.env` plaintext. Soubor musí mít perms `600` a vlastnit root nebo aspoň `app` user (uid 1001).

### 4. Vytvořit lokální složku pro zálohy

Na zdrojovém NASu:

```bash
mkdir -p /volume1/docker/raseliniste/backups
chown -R 1001:1001 /volume1/docker/raseliniste/backups
```

### 5. Pull image + Recreate container

DSM Container Manager → Image → **Pull** ghcr.io image latest (kvůli novým apk dependencies pg_client + rsync).

Pak Container Manager → Project `raseliniste` → **Recreate** (ne Restart — env z compose se musí znovu načíst).

## Test (manuální spuštění)

V browseru přihlášený jako admin:

```
https://www.raseliniste.cz/api/cron/backup?key=<CRON_SECRET>
```

Nebo `curl`:

```bash
curl -X POST https://www.raseliniste.cz/api/cron/backup \
     -H "x-cron-key: <CRON_SECRET>"
```

Vrátí JSON. Klíčové:
- `ok: true` → všechno proběhlo (pg_dump + uploads + rsync + retention)
- `steps.pgDump.bytes` → velikost DB dumpu (typicky 1-50 MB)
- `steps.uploadsTar.bytes` → velikost uploads tarballu (může být GB)
- `steps.rsync.output` → poslední řádky rsync logu

Po test ověř na cílovém NASu (`File Station` → `ZALOHY_APLIKACI/raseliniste`) že tam dnešní `db-*.sql.gz` a `uploads-*.tar.gz` jsou.

## Co dělat když rsync selže

Typické chyby:

- **`auth failed on module`** — DSM rsync user neexistuje nebo špatné heslo. Zkontroluj DSM > File Services > rsync.
- **`Permission denied`** — user nemá Read/Write na shared folder. Zkontroluj Shared Folder > Permissions.
- **`@ERROR: Unknown module 'ZALOHY_APLIKACI'`** — modul = přesné jméno shared folderu (case-sensitive). Zkontroluj v DSM.
- **`No route to host`** — Tailscale na jednom ze strojů odpojený. `tailscale status`.
- **`connection refused port 873`** — rsync daemon vypnutý v DSM File Services.

## Restore (kdyby bylo zle)

### DB restore

```bash
# Stáhnout backup z cílového NASu zpět
RSYNC_PASSWORD='...' rsync app-raseliniste@100.83.62.70::ZALOHY_APLIKACI/raseliniste/db-2026-05-17.sql.gz .

# V Docker postgres containeru raseliniste_db
docker exec -i raseliniste_db psql -U raseliniste -d raseliniste \
    < <(gunzip -c db-2026-05-17.sql.gz)
```

`--clean --if-exists` v dump znamená, že DROP + CREATE všechny tabulky znova, takže fresh restore.

### Uploads restore

```bash
RSYNC_PASSWORD='...' rsync app-raseliniste@100.83.62.70::ZALOHY_APLIKACI/raseliniste/uploads-2026-05-17.tar.gz .
# uploads/ je host bind mount v compose ./uploads → /data/uploads
tar -xzf uploads-2026-05-17.tar.gz -C /volume1/docker/raseliniste/
```

## Bezpečnostní poznámka

- DB dump obsahuje **všechna data včetně OAuth tokenů, hashed hesel, atd.** Cílový NAS musí být v důvěryhodné síti (Tailscale OK).
- **Heslo `app-raseliniste`** je v `.env` plaintext. Pro zvýšenou bezpečnost zvážit Docker secrets (až bude potřeba).
- Heslo bylo posláno v chatu — po nastavení **doporučuji změnit** v DSM a aktualizovat `.env`.

## Co dělá rsync `--delete`

Lokální složka záloh je **kanonický** stav. Pokud lokálně smažeš starý backup (retention), na vzdáleném se taky smaže.

Pokud chceš **delší retention vzdáleně** než lokálně (např. lokálně 30 dní, vzdáleně rok), v `src/lib/backup.ts` v `rsyncToRemote` odeber `--delete` z args. Pak vzdálený NAS roste donekonečna a pruning musíš dělat ručně (nebo přidat druhý retention skript na druhém NASu).
