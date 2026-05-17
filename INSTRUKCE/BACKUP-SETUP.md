# Backup setup — denní záloha na druhou Synology

## Architektura

**Dvouvrstvá záloha** (čisté oddělení concerns):

1. **Aplikace** (každou noc 2:00 přes cron dispatcher):
   - pg_dump → `/volume1/docker/raseliniste/backups/db-YYYY-MM-DD.sql.gz`
   - tar.gz uploads/ → `/volume1/docker/raseliniste/backups/uploads-YYYY-MM-DD.tar.gz`
   - Retention 30 dní (smaže starší)
   - Healthchecks.io ping (success / fail)

2. **DSM host** (každou noc 3:00 přes Task Scheduler):
   - rsync `/volume1/docker/raseliniste/backups/` → druhý NAS přes Tailscale
   - DSM má Tailscale balíček = vidí `100.83.62.70` nativně, žádný Docker hack

**Proč dvě vrstvy:** App produkce zůstává v bezpečném bridge network mode. Sync na druhý NAS je infrastrukturní úloha — patří DSM, ne aplikační logice. Pokud app jednou spadne, zálohovací sync běží dál.

## Setup

### 1. Cílový NAS (`100.83.62.70`)

DSM → **Control Panel** → **File Services** → **rsync** tab:
- ☑ Enable rsync service (port 873 default)
- **Edit rsync account** → vytvořit:
  - Username: `app-raseliniste`
  - Password: ten z chatu

DSM → **Shared Folder** → `ZALOHY_APLIKACI` → Edit → **Permissions**:
- Najít `app-raseliniste` → nastavit **Read/Write**

File Station → otevřít `ZALOHY_APLIKACI` → New folder `raseliniste`.

### 2. Zdrojový NAS — aplikační backup

```bash
# Vytvořit složku pro lokální zálohy (musí existovat, bind mount):
sudo mkdir -p /volume1/docker/raseliniste/backups
sudo chown -R 1001:1001 /volume1/docker/raseliniste/backups
```

Doplnit do `/volume1/docker/raseliniste/.env`:

```bash
# Healthchecks.io ping URL (vyrobíš v https://healthchecks.io)
BACKUP_HEALTHCHECK_URL=https://hc-ping.com/76c20e70-da3a-4c94-a74a-5a04ee396ac1
# Volitelně override default 30 dní:
# BACKUP_LOCAL_RETENTION_DAYS=30
```

⚠️ **Žádné `BACKUP_REMOTE_*` proměnné** — sync se dělá z hostu, ne z aplikace. Pokud bys je nastavil, app by se snažila pingnout druhý NAS z bridge networku a selhalo by to timeoutem.

Container Manager → Pull image latest → Project **Recreate**.

Test aplikačního backupu (přihlášený v browseru):
```
https://www.raseliniste.cz/api/cron/backup
```

Měl bys vidět JSON s `pgDump.ok=true`, `uploadsTar.ok=true`, `rsync.skipped=true` (správné — sync dělá host, ne app), `retention.ok=true`, `ok=true`.

### 3. Zdrojový NAS — sync na druhý NAS (Task Scheduler)

Zkopíruj skript z repa na NAS:

```bash
sudo mkdir -p /volume1/scripts
sudo cp /volume1/docker/raseliniste/scripts/sync-backups-to-remote.sh /volume1/scripts/
sudo chmod +x /volume1/scripts/sync-backups-to-remote.sh
```

Pokud chceš HC monitoring i pro tenhle sync task (doporučuji — odděleně od aplikačního checku):
- Healthchecks.io → Add Check `raseliniste-backup-sync`, period 1d + grace 1h
- Zkopíruj ping URL, edituj `/volume1/scripts/sync-backups-to-remote.sh`, dosaď do `HEALTHCHECK_URL=""` line

Test ručně (před přidáním do scheduleru):

```bash
sudo /volume1/scripts/sync-backups-to-remote.sh
```

Pokud OK, přidat do scheduleru:

DSM → **Control Panel** → **Task Scheduler** → **Create** → **Scheduled Task** → **User-defined script**:
- General → Task: `rsync-backups-to-remote`, User: `root`
- Schedule → **Daily** at **03:00** (hodinu po aplikačním backupu)
- Task Settings:
  - User-defined script: `/volume1/scripts/sync-backups-to-remote.sh`
  - ☑ Send run details by email (jen On abnormal termination)
- Save → confirm administrator password

## Restore

### DB restore (z druhého NASu)

```bash
# Stáhnout backup zpět z druhého NASu (přes rsync nebo File Station)
RSYNC_PASSWORD='...' rsync \
  app-raseliniste@100.83.62.70::ZALOHY_APLIKACI/raseliniste/db-2026-05-17.sql.gz .

# Spustit restore v postgres containeru
docker exec -i raseliniste_db psql -U raseliniste -d raseliniste \
    < <(gunzip -c db-2026-05-17.sql.gz)
```

`pg_dump --clean --if-exists` znamená DROP + CREATE všech tabulek → čistý restore.

### Uploads restore

```bash
RSYNC_PASSWORD='...' rsync \
  app-raseliniste@100.83.62.70::ZALOHY_APLIKACI/raseliniste/uploads-2026-05-17.tar.gz .

tar -xzf uploads-2026-05-17.tar.gz -C /volume1/docker/raseliniste/
```

## Troubleshooting

**App backup**: viz `/api/cron/backup` JSON output, `steps.<krok>.error`.

**Host sync skript**: spusť ručně `sudo /volume1/scripts/sync-backups-to-remote.sh`, vidíš rsync output. Typické chyby:
- `auth failed on module` — rsync user/password špatně, zkontroluj DSM > File Services
- `Unknown module 'ZALOHY_APLIKACI'` — shared folder neexistuje nebo case mismatch
- `connection refused port 873` — rsync daemon vypnutý v DSM
- `No route to host` — Tailscale ne UP. `tailscale status` na DSM hostu

**HC monitoring**: ve dashboardu vidíš historii pingů. „is DOWN" = ping nepřišel za period+grace. „failed" = `/fail` ping s body popisem chyby.
