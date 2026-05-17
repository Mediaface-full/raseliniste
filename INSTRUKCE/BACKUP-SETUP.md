# Backup setup — denní záloha na druhou Synology přes Tailscale

## Co to dělá

Každý den v **2:00 ráno** (cron `backup` v `cron-schedule.ts`):

1. **pg_dump** PostgreSQL databáze → `/data/backups/db-YYYY-MM-DD.sql.gz`
2. **tar.gz** složky `uploads/` → `/data/backups/uploads-YYYY-MM-DD.tar.gz`
3. **rsync** celé složky `/data/backups/` na druhý NAS přes SSH/Tailscale
4. **Retention** — smaže lokální soubory starší 30 dní (`--delete` v rsync zrcadlí to i na vzdáleném)

Pokud něco selže → mail na `NOTIFICATION_EMAIL`.

## Setup (jednorázově)

### 1. SSH klíč pro Tailscale rsync

Na **zdrojovém NASu** (kde běží raseliniste), v Bash:

```bash
cd /volume1/docker/raseliniste/   # tady kde máš docker-compose.yml
ssh-keygen -t ed25519 -f backup_id -N ''
chmod 600 backup_id
cat backup_id.pub
```

Vypíše public key. Tenhle public key přidej na **cílový NAS** do `~/.ssh/authorized_keys` (přihlášený jako SSH uživatel co bude přijímat zálohy, typicky `admin`).

### 2. Cílová složka na druhém NASu

Na **cílovém NASu** vytvoř složku pro zálohy:

```bash
# přihlas se SSH na druhý NAS (Tailscale)
ssh admin@<TAILSCALE_HOST_DRUHEHO_NASU>
mkdir -p /volume1/backups/raseliniste
chown admin:users /volume1/backups/raseliniste
```

### 3. Doplň env proměnné

Na zdrojovém NASu v `/volume1/docker/raseliniste/.env` přidej:

```bash
BACKUP_REMOTE_HOST=<tailscale-hostname-druheho-nasu>  # např. zaloha-nas.tail-net.ts.net
BACKUP_REMOTE_PATH=/volume1/backups/raseliniste
BACKUP_SSH_USER=admin
# Volitelně override default 30 dní:
# BACKUP_LOCAL_RETENTION_DAYS=30
```

### 4. Known_hosts (one-time TOFU)

Před prvním spuštěním backupu ověř SSH připojení z hostu (vytvoří `known_hosts`):

```bash
ssh -i backup_id -o UserKnownHostsFile=./known_hosts admin@<TAILSCALE_HOST> 'echo ok'
# napíše "The authenticity of host... yes/no" → yes
# pak "ok" → odpoj se
chmod 644 known_hosts
```

`known_hosts` musí být v stejné složce jako `docker-compose.yml`.

### 5. Vytvoř lokální složku pro zálohy

```bash
mkdir -p /volume1/docker/raseliniste/backups
chown -R 1001:1001 /volume1/docker/raseliniste/backups   # uid app v containeru
```

### 6. Restart containeru

V DSM Container Manager → Project `raseliniste` → **Recreate** (ne Restart — env z compose se musí znovu načíst).

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

Vrátí JSON s 4 kroky. Pokud `ok: true`, všechno OK. Pokud `ok: false`, viz `steps.<krok>.error`.

## Co dělat když rsync selže

Typické chyby:

- **Permission denied (publickey)** — public key na cílovém NASu chybí nebo má špatné práva. Zkontroluj `~/.ssh/authorized_keys` (perms 600, parent .ssh 700).
- **Host key verification failed** — `known_hosts` chybí nebo cílový host změnil klíč. Smaž `known_hosts` a opakuj krok 4.
- **No route to host** — Tailscale na jednom ze strojů odpojený. `tailscale status` ověř.

## Restore (kdyby bylo zle)

### DB restore

```bash
# zkopíruj backup zpět na NAS
scp admin@<TAILSCALE_HOST>:/volume1/backups/raseliniste/db-2026-05-17.sql.gz .

# v Docker postgres containeru
docker exec -i raseliniste_db psql -U raseliniste -d raseliniste \
    < <(gunzip -c db-2026-05-17.sql.gz)
```

`--clean --if-exists` v dump znamená, že DROP + CREATE všechny tabulky znova, takže fresh restore.

### Uploads restore

```bash
scp admin@<TAILSCALE_HOST>:/volume1/backups/raseliniste/uploads-2026-05-17.tar.gz .
# uploads/ je host bind mount v compose ./uploads → /data/uploads
tar -xzf uploads-2026-05-17.tar.gz -C /volume1/docker/raseliniste/
```

## Bezpečnostní poznámka

- DB dump obsahuje **všechna data včetně OAuth tokenů, hashed hesel, atd.** Cílový NAS musí být důvěryhodný (tvůj).
- SSH klíč v repo NEKOMITOVAT — je v `.gitignore` (auto, protože `backup_id` není v `git ls-files`).
- Pokud druhý NAS pojede Tailscale ACL, omez přístup jen na rsync port (22) ze zdrojového NASu.

## Co dělá rsync `--delete`

Lokální složka záloh je **kanonický** stav. Pokud lokálně smažeš starý backup (retention), na vzdáleném se taky smaže.

Pokud chceš **delší retention vzdáleně** než lokálně (např. lokálně 30 dní, vzdáleně rok), v `src/lib/backup.ts` v `rsyncToRemote` odeber `--delete` z args. Pak vzdálený NAS roste donekonečna a pruning musíš dělat ručně (nebo přidat druhý retention skript na druhém NASu).
