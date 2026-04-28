# Rašeliniště — Produkční Runbook

Operativní příručka po deployi. Pro tebe (Gideona), když budeš potřebovat něco udělat, opravit, nebo si připomenout co kde je. Samostatně od `HANDBOOK.md` (ten je spíš technická reference pro dev).

> **Pravidlo #1:** než něco mažeš na produkci, udělej backup DB (viz sekce 7). Je to 1 příkaz.

---

## Obsah

0. [Stav po deployi](#0-stav-po-deployi)
1. [Přihlášení](#1-přihlášení)
2. [Co nastavit teď hned (po prvním loginu)](#2-co-nastavit-teď-hned-po-prvním-loginu)
3. [iPhone Shortcuty](#3-iphone-shortcuty)
4. [Health Auto Export aplikace](#4-health-auto-export-aplikace)
5. [Měsíční zdravotní report — zapnutí](#5-měsíční-zdravotní-report--zapnutí)
6. [Update produkce (deploy nové verze)](#6-update-produkce-deploy-nové-verze)
7. [Backup & Restore databáze](#7-backup--restore-databáze)
8. [Restart / Logy / Troubleshoot](#8-restart--logy--troubleshoot)
9. [Co kde je na NASu](#9-co-kde-je-na-nasu)
10. [Bezpečnostní pravidla](#10-bezpečnostní-pravidla)
11. [Známé drobnosti k opravě](#11-známé-drobnosti-k-opravě)

---

## 0. Stav po deployi

**Co ti teď funguje live:**

| Komponenta | Stav | Kde |
|---|---|---|
| Doména + HTTPS | ✅ | `https://www.raseliniste.cz` |
| DSM Reverse Proxy | ✅ | 443 → localhost:3333 |
| Let's Encrypt cert | ✅ | pro `www.raseliniste.cz` |
| Container app | ✅ | `raseliniste_app` (ghcr.io image) |
| Container DB | ✅ | `raseliniste_db` (postgres:16-alpine) |
| Databáze | ✅ | 9 migrací + Gideon user |
| Login | ✅ | heslo + passkey (Touch ID) |
| Capture / Journal / Health / Settings | ✅ | všechny moduly naběhnuté |
| GitHub Actions pipeline | ✅ | `main` push → build → ghcr.io |

**Co zatím NENÍ aktivní (doplníš podle potřeby):**

- 🔶 **Email reporty** — Resend API klíč chybí (maily jen logované, neodesílají se)
- 🔶 **Měsíční cron** — Task Scheduler ještě nemá úlohu (budeš to zapínat v kroku 5)
- 🔶 **iPhone Shortcuty** — ještě nevytvořené (krok 3)
- 🔶 **Health Auto Export** — iPhone aplikace ještě nekonfigurovaná (krok 4)

---

## 1. Přihlášení

- **URL:** https://www.raseliniste.cz/login
- **Username:** `Gideon`
- **Password:** (to, co jsi si zapsal z `ADMIN_PASSWORD` v `.env`)
- **Passkey:** po prvním hesle sis zaenrolloval Touch ID — teď už stačí **heslo + otisk**

**Pro budoucí enrollment dalších zařízení** (např. iPhone):
- Po přihlášení z aktuálního zařízení nemůžeš přidat druhý passkey (nemáme UI) — je to v plánu
- Pro teď: pokud se chceš přihlásit z iPhonu, **udělej to z Safari** na stejné doméně. Pokud tě přesměruje na enrollment, ignorujeme — budeš muset v budoucnu přidat UI pro „přidat další passkey".

---

## 2. Co nastavit teď hned (po prvním loginu)

### 2.1 Vyplň svůj notification email (kam chodí měsíční health reporty)

1. Vpravo nahoře v sidebaru → **Nastavení → E-mailové reporty**
2. Zadej svou soukromou adresu (tu, kam fakticky chodíš číst)
3. **Uložit**

> Poznámka: dokud nenastavíš **Resend** (sekce 5), maily se fyzicky neodesílají — jen se loguje, že měly jít. Analýzy se pořád ukládají do historie v `/health`.

### 2.2 Vytvoř API tokeny (pro Shortcuty a HAE)

1. Sidebar → **Nastavení → API tokeny**
2. Klik **Nový token** → název (např. `iPhone Shortcut Capture`) → **Vytvořit**
3. **Plain token (začíná `rasel_`) se zobrazí jen jednou!** Zkopíruj ho a ulož do password manageru / Apple Keychain / cokoliv co máš rád
4. Opakuj pro:
   - `iPhone Shortcut Deník`
   - `Health Auto Export`
   - *(Volitelně lze použít 1 univerzální token pro všechny 3 — ale separátní je bezpečnější, můžeš odvolat jen jeden)*

**Odvolání tokenu** (když něco uteče nebo ztratíš telefon): stejná stránka → ikona 🗑️ vedle tokenu → **Opravdu odvolat** → potvrdit. Tokens s revokedAt zůstanou v DB kvůli auditu, ale ingest endpointy je odmítnou.

---

## 3. iPhone Shortcuty

Přesný návod je **v aplikaci**: sidebar → **Nastavení → iPhone Shortcuty**. Tady jen rychlý přehled:

### Shortcut 1 — Rasel Capture (obecný diktát)
- **Použij když:** diktuješ cokoli — úkol, myšlenku, poznatek, nápad
- **Endpoint:** `POST https://www.raseliniste.cz/api/ingest`
- **Header:** `Authorization: Bearer <TOKEN_CAPTURE>`
- **Body (JSON):** `{ "text": <Dictated Text>, "source": "SHORTCUT" }`
- **Výsledek:** Gemini roztřídí, položky čekají v `/triage`

### Shortcut 2 — Rasel Deník (přímý deníkový zápis)
- **Použij když:** víš, že to je **deník** (reflexe, pocity, denní záznam)
- **Endpoint:** `POST https://www.raseliniste.cz/api/journal/ingest`
- **Header:** `x-api-key: <TOKEN_DENIK>`
- **Body (JSON):** `{ "text": <Dictated Text> }` *(volitelně `location`)*
- **Výsledek:** Gemini text učeše + přidá hashtagy, rovnou v `/journal`

**Doporučené mapování v iPhonu:**
- **Action Button (krátký stisk)** → Capture
- **Siri fráze „zapiš deník"** nebo **widget na lock screen** → Deník

**Test bez iPhone** (zkouška z Mac Terminalu):

```bash
curl -X POST https://www.raseliniste.cz/api/ingest \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Test capture z terminalu","source":"MANUAL"}'
```

Odpověď `{"recordingId":"...", "entriesCount":N}` = funguje. Pak v `/triage` vidíš položku.

---

## 4. Health Auto Export aplikace

Přesný návod je v aplikaci: **Nastavení → Napojení Health**. Zkráceně:

1. Na iPhone App Store — **Health Auto Export** (Premium ~3 €/měs — REST API je placená fíča)
2. Po instalaci: Settings → Health → Data Access → povol **Health Auto Export** pro všechny relevantní kategorie
3. V HAE aplikaci → **Automations → Add** → **REST API**
4. Vyplň:
   - URL: `https://www.raseliniste.cz/api/health-ingest`
   - Method: `POST`
   - Format: `JSON` (ne CSV!)
   - Aggregation: `Daily`
   - Frequency: `Daily` (nebo `Every 6 hours`)
   - **Custom header:** `x-api-key: <TOKEN_HAE>`
5. Vyber metriky: Activity (kroky, energie, vzdálenost, cvičení), Heart (HRV, klidový tep, dech), Sleep, Body, Vitals (tlak pokud měříš), ECG pokud máš
6. **Test:** v HAE tlačítko **Export Now** → otevři `/health` → počty metrik by se měly zvýšit

**Historický roční export jsme ti už naimportovali** na lokální DB během vývoje. Na produkční DB NENÍ — pokud chceš historii i tam, proveď v HAE aplikaci **export celé historie** a Export Now pošle to všechno. Díky unique indexu to ingest endpoint zvládne i pro tisíce záznamů.

---

## 5. Měsíční zdravotní report — zapnutí

Dva kroky: **Resend** (aby se poslal mail) + **Task Scheduler** (aby se spustil poslední den v měsíci).

### 5.1 Resend account

1. https://resend.com → registrace (zdarma 3 000 mailů/měs)
2. **Domains → Add Domain** → `raseliniste.cz`
3. Resend ti ukáže TXT + MX DNS záznamy — přidej je u registrátora (Forpsi / Wedos / kde máš doménu)
4. Po ověření (10-30 min): **API Keys → Create** → zkopíruj klíč (začíná `re_`)

### 5.2 Doplnit do produkčního `.env`

Na Macu ve File Station připoj NAS → jdi do `/docker/raseliniste/` → otevři `.env` v editoru → doplň:

```
RESEND_API_KEY=re_tvůj_klíč
NOTIFICATION_FROM=reports@raseliniste.cz
```

`NOTIFICATION_EMAIL` nech prázdný — bere se z `/settings/reports` (už jsi tam zadal v kroku 2.1).

Ulož.

### 5.3 Restartuj kontejner

**Container Manager → Project `raseliniste` → Stop → Build → Start** (nebo **Action → Rebuild**). Bude potřeba, aby si app kontejner načetl nové env.

Test v SSH:

```bash
sudo docker exec -i raseliniste_app sh -c 'echo $RESEND_API_KEY'
```

Mělo by vypsat tvůj klíč. Pokud prázdno, něco se nezvládlo.

### 5.4 Task Scheduler

1. DSM → **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**
2. **General:**
   - Task: `Raseliniste monthly health report`
   - User: `root`
3. **Schedule:**
   - Run on: **Monthly**
   - Date: **Last day of month**
   - First run time: **23:00**
4. **Task Settings → Run command:**

```bash
curl -fsS -X POST https://www.raseliniste.cz/api/cron/monthly-health-report \
     -H "x-cron-key: lbScXJnxjhQV868xf8Xp4raAp3NUdW4pHuFY4nz9ibs=" \
     --max-time 120
```

*(Ten `x-cron-key` je `CRON_SECRET` z `.env` — v tvém případě ta hodnota výše.)*

Uložit. Pro okamžitý test: pravý klik na task → **Run**.

V `/health` uvidíš novou analýzu s badge **měsíční**. A v mailu ti přijde report (pokud je Resend nakonfigurovaný).

---

## 6. Update produkce (deploy nové verze)

Když něco upravím (nebo ty) v lokálním kódu:

1. **Na Macu:** git commit → git push (GitHub Desktop, „Push origin")
2. **GitHub Actions** automaticky:
   - Build image (~3-5 min)
   - Push na `ghcr.io/duchnotvor/raseliniste/app:latest`
3. **Na NAS:**
   - Container Manager → **Image** tab → najdi `ghcr.io/duchnotvor/raseliniste/app` → **Pull latest**
   - Container Manager → **Project raseliniste** → **Action → Rebuild** (nebo Stop → Build → Start)
4. **Ověř v `/` že vše běží** (login, rychlý přehled)

**Migrace se aplikují automaticky** při startu kontejneru (entrypoint volá `prisma migrate deploy`).

### ⚠️ Důležité: změna `.env` = `docker compose up -d --force-recreate`

`docker restart <container>` jen restartuje proces **ve stávajícím kontejneru** — env proměnné zůstávají zamrzlé z doby kdy se kontejner vytvořil. Když měníš `.env`:

```bash
cd /volume1/docker/raseliniste
sudo docker compose up -d --force-recreate
```

Tohle:
1. Zabije stávající kontejnery
2. Znovu vytvoří nové s aktuálním `.env`
3. Data v named volumes (Postgres) přežijí

Ekvivalent přes DSM GUI: Container Manager → Project → **Stop** → **Build** (**ne** Start — Start jen resume existující).

Pokud něco selže:
- Container Manager → Container `raseliniste_app` → **Log** → čti posledních ~50 řádků
- Pokud je problém v migraci: *heal-migrations.mjs* si v entrypointu čistí zaseklé
- Jinak pošli mi log a řekneme si

---

## 7. Backup & Restore databáze

### Manuální backup (dělej občas — týdně? měsíčně?)

Přes SSH na NAS:

```bash
sudo docker exec raseliniste_db pg_dump -U raseliniste raseliniste | gzip > ~/rasel-$(date +%F).sql.gz
```

Soubor bude v tvém home na NASu (`/var/services/homes/<user>/rasel-2026-04-20.sql.gz`). File Station si ho pak zkopíruj kam chceš (external disk, Hyper Backup, Google Drive).

### Automatický backup (doporučuju)

Task Scheduler → **User-defined script** → Weekly, Sunday 03:00:

```bash
sudo docker exec raseliniste_db pg_dump -U raseliniste raseliniste | gzip > /volume1/backup/raseliniste/rasel-$(date +%F).sql.gz
# Smaž zálohy starší než 90 dní
find /volume1/backup/raseliniste -name "rasel-*.sql.gz" -mtime +90 -delete
```

*(Přizpůsob `/volume1/backup/raseliniste/` podle tvé struktury. Složku si vytvoř předem v File Station.)*

### Restore (když to potřebuješ)

```bash
gunzip -c rasel-2026-04-20.sql.gz | sudo docker exec -i raseliniste_db psql -U raseliniste -d raseliniste
```

**POZOR:** tohle nepřepíše existující data — přidá je. Pro čistý restore nejdřív drop/recreate DB nebo použij separátní restore metodu. Pokud to budeš někdy potřebovat, ozvi se, provedu tě.

---

## 7.5 Deploy nové verze — JEDEN PŘÍKAZ

Standardní deploy = `~/deploy.sh`. Jednorázová instalace, pak při každém deployi
stačí napsat `~/deploy.sh` a vše proběhne samo. Pořadí:

1. **Push commit z Macu** přes GitHub Desktop
2. **Počkej ~3 min** na GitHub Actions build (Actions tab v repu)
3. **SSH na NAS** + napiš `~/deploy.sh`. Hotovo.

### Jednorázová instalace skriptu (uděláš poprvé, pak nikdy znova)

SSH na NAS, napiš (jeden blok):

```bash
sudo tee /root/deploy.sh > /dev/null << 'DEPLOY_EOF'
#!/bin/sh
set -e
cd /volume1/docker/raseliniste

echo "→ [1/4] Stahuji docker-compose.yml z GitHubu"
curl -fsSL -o docker-compose.yml.new \
  https://raw.githubusercontent.com/Duchnotvor/raseliniste/main/docker-compose.yml

echo "→ [2/4] Validace YAML"
mv docker-compose.yml docker-compose.yml.bak
mv docker-compose.yml.new docker-compose.yml
if ! docker compose config > /dev/null 2>&1; then
  echo "❌ YAML invalid, vracím zálohu"
  mv docker-compose.yml.bak docker-compose.yml
  exit 1
fi
rm -f docker-compose.yml.bak

echo "→ [3/4] Stahuji image z ghcr.io"
docker compose pull

echo "→ [4/4] Recreate kontejneru"
docker compose up -d --force-recreate

echo ""
echo "→ Stav:"
docker compose ps

echo ""
echo "→ Logy (posledních 15 řádků):"
sleep 5
docker compose logs app --tail 15

echo ""
echo "✓ Deploy hotový. Ověř v prohlížeči: https://www.raseliniste.cz"
DEPLOY_EOF

sudo chmod +x /root/deploy.sh
```

A volitelně alias, ať jen píšeš `deploy`:

```bash
echo "alias deploy='/root/deploy.sh'" | sudo tee -a /root/.profile
source /root/.profile
```

### Použití (od teď napořád)

Po každém pushu na GitHub:

```bash
deploy
# nebo bez aliasu: ~/deploy.sh
# nebo: sudo /root/deploy.sh
```

Skript:
1. Stáhne nejnovější `docker-compose.yml` z GitHubu (žádné ruční editace YAML)
2. Validuje syntaxi (pokud rozbitý → vrátí zálohu, neselže)
3. Pulluje novou image z ghcr.io
4. Recreate kontejneru (`up -d --force-recreate`)
5. Ukáže status + posledních 15 logů

**Pokud něco selže**, vrátí poslední pracovní compose ze zálohy a vypíše chybu.

### Odstranění problémů

- `Image is up to date` → GitHub Actions build ještě neskončil. Počkej 1-2 min.
- `permission denied` na `gcp-key.json` → `sudo chmod 644 /volume1/docker/raseliniste/gcp-key.json`
- Aplikace nestartuje → `docker compose logs app --tail 100` a pošli error.

---

## 8. Restart / Logy / Troubleshoot

### Rychlý restart kontejneru

DSM → Container Manager → Container → `raseliniste_app` → **Action → Restart**.

### Podívat se do logu

Container Manager → Container → `raseliniste_app` → tab **Log**. Posledních cca 200 řádků. Hledej `[error]`, `500`, `Error`, `Failed`.

### SSH přímý přístup

```bash
ssh <tvoj_user>@84.242.98.78
sudo docker logs raseliniste_app --tail 100
sudo docker logs raseliniste_db --tail 50
```

### Exec do běžícího kontejneru (pro ad-hoc debug / Prisma studio / cokoliv)

```bash
sudo docker exec -it raseliniste_app sh
# teď jsi uvnitř /app
```

---

### ⚠️ Časté pasti při deploy a editaci configu na NASu

Tyhle věci nás v minulosti shodily, ať se neopakují:

1. **Synology nemá `nano`, jen `vi`.**
   - `sudo nano <file>` → `sudo: nano: command not found`
   - Použij `sudo vi <file>` (insert: `i`, save+exit: `Esc` pak `:wq`).
   - Nebo neinteraktivní append přes `tee`/`sed` — viz níže.

2. **Heredoc příkazy musí běžet v shellu, NE se vkládat do souborů.**
   - Když chceš doplnit řádky do `.env`, použij **v shellu**:
     ```bash
     cat << 'EOF' | sudo tee -a /volume1/docker/raseliniste/.env > /dev/null

     # ---- Vertex AI ----
     VERTEX_PROJECT=raseliniste
     VERTEX_LOCATION=europe-west1
     GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json
     EOF
     ```
   - **Nikdy** to nevkládej do souboru přes `vi` — heredoc se zapíše doslova jako text.
   - **Stalo se nám:** vložení heredoc bloku do `docker-compose.yml` rozbilo YAML →
     `parsing docker-compose.yml: yaml: line 50: could not find expected ':'`.
   - **Oprava** (smaž od korupčního řádku do konce):
     ```bash
     sudo sed -i '/^sudo tee/,$d' /volume1/docker/raseliniste/docker-compose.yml
     sudo docker compose config > /dev/null && echo OK
     ```

3. **`docker compose restart` nečte změny v `.env`.**
   - Jen restartuje proces se starými env hodnotami.
   - Pro aplikaci `.env` změn použij vždy:
     ```bash
     sudo docker compose up -d --force-recreate
     ```

4. **Validace YAML před recreate** ti ušetří pád.
   ```bash
   sudo docker compose config > /dev/null && echo OK || echo ROZBITY
   ```

5. **`gcp-key.json` práva.** Přes File Station nahraný soubor často skončí
   s vlastníkem typu `mediaface_sftp_upload` a permissions `755 + ACL`.
   Hned po nahrání:
   ```bash
   sudo chown root:root /volume1/docker/raseliniste/gcp-key.json
   sudo chmod 600 /volume1/docker/raseliniste/gcp-key.json
   sudo setfacl -b /volume1/docker/raseliniste/gcp-key.json 2>/dev/null
   ```
   Po `ls -la` musí vlastník být `root` a perms `-rw-------` (žádný `+` na konci).

6. **MIME whitelist v `lib/uploads.ts` ignoruje codec parametry.**
   - Browser MediaRecorder posílá `audio/webm; codecs=opus` (s parametry)
   - iOS Voice Memos exportuje `audio/x-m4a`
   - `extFromMime()` musí strippovat parametry (`split(";")[0]`) a mít whitelist:
     `audio/webm`, `audio/mp4`, `audio/x-m4a`, `audio/m4a`, `audio/mpeg`,
     `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/aac`, `audio/flac`.
   - Pokud `Nepodporovaný typ souboru: audio/...` → doplnit do whitelist.

7. **Po edit `.env` ověř, že se to opravdu zapsalo.**
   ```bash
   tail -10 /volume1/docker/raseliniste/.env
   sudo grep -E "VERTEX|GOOGLE_APPLICATION" /volume1/docker/raseliniste/.env
   ```

8. **`docker compose pull` musí stáhnout novou image, ne říct „up to date".**
   - Pokud řekne *Image is up to date* hned po pushi, GitHub Actions build
     ještě nedoběhl. Počkej 1-2 min a `pull` znovu.
   - Po stažení **vždy `up -d --force-recreate`** (jen `up -d` to nereinicializuje).

9. **`docker-compose.yml` na NASu se NEAUTO aktualizuje.**
   - Když do něj přidám novou env proměnnou (např. `VERTEX_PROJECT`),
     na NASu pořád běží stará verze, dokud ji ručně nepřepíšeš.
   - Projevilo se: `docker compose exec app env` neukazoval `VERTEX_PROJECT`,
     i když `.env` ho měl. Compose musí mít odpovídající `environment:` blok.
   - Řešení: deploy script `~/deploy.sh` níže to dělá automaticky přes
     `curl` z GitHubu.

10. **`gcp-key.json` permissions: 600 nestačí, použij 644.**
    - Kontejner běží jako neroot uživatel uvnitř (typicky `node` UID 1000).
    - `chmod 600` (root-only) → kontejner dostane `EACCES: permission denied`.
    - `chmod 644` (read-all) je správně. Soubor je v Docker volume, takže
      ostatní procesy na NASu k němu nemají přístup bez sudo.
    - Stejné platí pro jiné secret JSON soubory mountované do kontejneru.

11. **Vertex audio > 18 MB jde přes Files API, ne inline.**
    - Gemini API limit pro inline audio = 20 MB. 90min M4A 64 kbps má ~40 MB.
    - V `lib/audio-transcribe.ts` se velké soubory uploadují přes `genai.files.upload()`,
      pak se reference v `generateContent` přes `fileData.fileUri`.
    - Pro inline má přednost (nižší latence) — pouze nad 18 MB Files API.

12. **Heredoc paste do souboru = catastrophe.**
    - Stalo se: vložení `cat << EOF | tee -a .env ... EOF` přes klávesnici
      do nano/vi vyústilo v zapsání PŘÍKAZU jako TEXTU do souboru.
    - Pokud `docker-compose.yml` má na konci řádky typu `sudo tee -a .env...`,
      vyřeš to:
      ```bash
      sudo sed -i '/^sudo tee/,$d' /volume1/docker/raseliniste/docker-compose.yml
      sudo docker compose config > /dev/null && echo OK
      ```
    - Heredoc patří **do shellu** (přímo jako příkaz), ne do souboru.

13. **Standard deploy proces — `~/deploy.sh` skript** (viz sekce „Deploy"
    níže). Jeden příkaz `~/deploy.sh` udělá vše: aktualizuje compose,
    pulluje image, recreate, ukáže logy.

14. **Astro nezahrnuje `src/assets/*` do `dist/server/`.**
    - Soubory v `src/assets/*` (fonty, obrázky) Astro do build artefaktů
      **nezkopíruje**, pokud nejsou Vite-importované (`?url`, `?inline`).
    - Při `fs.readFile()` na nich v produkci → `ENOENT: no such file`.
    - **Řešení:** dej je do `public/<podsložka>/`. Astro je automaticky
      kopíruje do `dist/client/<podsložka>/`.
    - V kódu hledáš přes fallback chain (dev `public/fonts`, prod
      `dist/client/fonts`, případně `src/assets/fonts` pro lokální skripty).
    - Týká se: PDF fontů (NotoSans/NotoSerif), apple-touch-icon, atd.

15a. **Empty string z `${VAR:-}` v compose lámal zod env validaci.**
    - Docker compose syntax `${MY_VAR:-}` nastaví prázdný string `""`
      pokud `MY_VAR` není v `.env`. Ne `undefined`.
    - Zod `.optional()` chytá jen `undefined`, prázdný string projde
      do `.min(N)` validace → fail "Too small".
    - Trvalý fix v `src/lib/env.ts`: helper `emptyToUndef()` preprocessuje
      `""` na `undefined` PŘED validací. Všechny optional env pole jsou
      obalené, plus `.pipe()` pro defaulty.
    - **Při přidávání nových env proměnných: vždy použij `emptyToUndef(...)`.**
    - Projevilo se: login po deployi vrací 500 „Něco se pokazilo".
      `docker compose logs app | grep "Invalid environment"` ukáže problém.

15. **Když UI projektu zaseklý — smazat přímo přes DB.**
    - Když klik na projekt v `/studna` neotevírá detail nebo cokoli vypadá
      zaseknutě, smaž přímo:
      ```bash
      # Najít ID
      sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml \
        exec postgres psql -U raseliniste -d raseliniste \
        -c "SELECT id, name FROM \"ProjectBox\";"

      # Smazat konkrétní (cascade automaticky vyčistí recordings + invitations)
      sudo docker compose -f /volume1/docker/raseliniste/docker-compose.yml \
        exec postgres psql -U raseliniste -d raseliniste \
        -c "DELETE FROM \"ProjectBox\" WHERE id='<cuid>';"
      ```
    - Stejný pattern pro jakoukoli tabulku — uvozovky kolem názvu tabulky
      v Postgres potřebují backslash escape (`\"ProjectBox\"`).

### Časté problémy → fix

| Symptom | Řešení |
|---|---|
| Login `INVALID_CREDENTIALS` | Heslo v `.env` nesouhlasí s hashem v DB → použij SQL update (napiš mi, vygeneruju SQL) |
| Passkey nefunguje | WebAuthn je vázaný na doménu. Pokud jsi změnil `APP_URL` v env, dřívější passkey nefungují — musíš přihlásit heslem a znovu zaregistrovat |
| `/health` prázdné | HAE ještě neposlalo data, nebo token je špatný. Zkontroluj `/settings/tokens` (poslední use), test endpointu přes curl |
| Cron vrátil 429 | Rate limit Gemini Pro → čekej 24 h nebo Studio → Billing → paid |
| Cron vrátil 503 CRON_NOT_CONFIGURED | `CRON_SECRET` v `.env` chybí, nebo kontejner ho neviděl → restart |
| Mail se neodeslal | Resend nenakonfigurovaný nebo DNS ověření ještě neprošlo — zkontroluj `/settings/reports` status kartu |
| Aplikace nestartuje | Log → hledej "failed migration", "EACCES", "ENOENT". Buď heal-migrations nezabral, nebo permissions na `./uploads/` |
| PDF padá `ENOENT NotoSans-*.ttf` | Fonty musí být v `public/fonts/` (ne `src/assets/fonts/`) — viz bod 14 výše |
| 500 error na invite hosta ve Studně | Zkontroluj log — pravděpodobně padá kvůli PDF fontu nebo prisma constraint. Po opravě fontů 99 % případů zmizí |
| `/api/health/ai` `EACCES gcp-key.json` | `sudo chmod 644 gcp-key.json` (kontejner běží jako neroot, 600 nestačí) |
| Studna projekt v UI nejde otevřít/smazat | Smaž přímo v DB — viz bod 15 |

### Nuclear option — přestartovat všechno

```bash
# SSH
sudo docker compose -f /docker/raseliniste/docker-compose.yml down
sudo docker compose -f /docker/raseliniste/docker-compose.yml up -d
```

Data v named volume `postgres_data_v1` přežijí.

---

## 9. Co kde je na NASu

```
/docker/raseliniste/
├── docker-compose.yml       # konfigurace služeb (app + postgres)
├── .env                     # všechny secrets + konfigurace (DB heslo, tokens atd.)
└── uploads/                 # bindmount pro budoucí file upload modul (zatím prázdné)
```

**Volumes (Docker managed, na NASu pod `/var/lib/docker/volumes/` nebo DSM-specific path):**

```
raseliniste_postgres_data_v1/   # data Postgresu — pg_dump ZÁLOHUJ
raseliniste_app_cache/          # Astro session cache (regeneruje se, nezálohuj)
```

**GitHub:**
```
https://github.com/duchnotvor/raseliniste         # soukromé
ghcr.io/duchnotvor/raseliniste/app:latest         # Public image
```

**Klíče / secrets:**

| Co | Kde je uložené | Co s tím |
|---|---|---|
| `ADMIN_PASSWORD` | `.env` + tvůj password manager | Tvé jednorázové heslo pro login (po enroll passkey už skoro nepotřeba) |
| `DB_PASSWORD` | `.env` | Nikam nedávej, nikdy nesdílej |
| `SESSION_SECRET` | `.env` | Podepisuje cookies — když to změníš, všichni jsou odhlášení |
| `GEMINI_API_KEY` | `.env` | Tvůj Google AI Studio klíč. Reroll přes studio pokud leakne |
| `CRON_SECRET` | `.env` + Task Scheduler script | Shared secret pro cron auth |
| `RESEND_API_KEY` | `.env` | Resend dashboard — reroll tam |
| **API tokeny (rasel_...)** | Jen v password manageru (hash v DB) | Zobrazeny v `/settings/tokens` jen prefix + lastUsedAt |

---

## 10. Bezpečnostní pravidla

**NIKDY NE:**
- Necommituj `.env` nebo jiné secrets do gitu (máme to v `.gitignore`)
- Nezveřejňuj `CRON_SECRET` — mohl by kdokoli spustit měsíční analýzu (bezvýznamné ale otravné)
- Nesdílej API tokeny — každý má svůj scope (Capture / Deník / Health)
- Nevypínej HSTS v Reverse Proxy
- Neposunuj `APP_URL` jen tak — rozbije to WebAuthn pro dřívější passkeys

**UDĚLEJ:**
- **Backup DB pravidelně** (viz sekce 7)
- **Odvolávej tokeny** které nepoužíváš (`/settings/tokens`)
- **Rotuj `SESSION_SECRET`** cca 1× ročně (stačí `openssl rand -base64 48`, přepsat v `.env`, restart — nutí to re-login, ale je to drobnost)
- **Sleduj login attempts** v DB občas — `SELECT * FROM "LoginAttempt" ORDER BY "createdAt" DESC LIMIT 20;`

---

## 11. Známé drobnosti k opravě

### 🐛 Astro `checkOrigin: true` blokuje POST requesty za Reverse Proxy

**Stav:** V `astro.config.mjs` jsme měli:
```js
security: {
  checkOrigin: true,
},
```

Astro 6 kontroluje zda `Origin` header z prohlížeče matchuje URL origin z request socketu. Problém: při Reverse Proxy (DSM) uvidí Astro request URL jako `http://localhost:3000/...`, ale prohlížeč posílá `Origin: https://www.raseliniste.cz`. **Mismatch → Astro vrátí 403 `Cross-site POST form submissions are forbidden`.**

Response není JSON, takže klientský kód hodí `Unexpected token 'C', "Cross-site"... is not valid JSON`.

**Dopad:** Žádný POST request z prohlížeče neprojde. Login, logout, passkey, create token — všechno failuje. Aplikace kompletně nepoužitelná za Reverse Proxy.

**Fix (commitnutý 2026-04-20):**
```js
security: {
  checkOrigin: false,  // CSRF pokrytý sameSite=strict cookies
},
```

**Alternativní čistší řešení (budoucí):** nastavit proxy trust v adapteru (`@astrojs/node` má `trustProxyHeaders` option v novějších verzích) a předávat `X-Forwarded-Proto` + `X-Forwarded-Host` z DSM Reverse Proxy. Pak by Astro vidělo správný externí origin a checkOrigin by přešel.

### 🐛 docker-compose.yml `${VAR:-}` vždycky pošle prázdný string

**Stav:** V `docker-compose.yml` máme:
```yaml
environment:
  RESEND_API_KEY: ${RESEND_API_KEY:-}
  NOTIFICATION_EMAIL: ${NOTIFICATION_EMAIL:-}
```
Syntax `${VAR:-}` znamená „hodnota z env, nebo **prázdný string** pokud nenastavená". Takže i když řádek z `.env` úplně vymažeš, docker-compose do kontejneru **stejně** propíše `RESEND_API_KEY=""` (prázdný string). A prázdný string fail na zod `.min(10)`.

**Dopad:** Při prvním deployi stačí aby v `.env` byly 2 prázdné řádky (z kopie `.env.example`) nebo aby řádky zcela chyběly — v obou případech zod failuje. Jediné co zafunguje je dát tam **platné hodnoty nebo fake platné placeholders** (`disabled_placeholder_1234567890`, `noreply@raseliniste.cz`).

**Fix:**
```yaml
# docker-compose.yml — u striktně-optional proměnných:
environment:
  RESEND_API_KEY: ${RESEND_API_KEY}         # bez :-  = pokud není v .env, nepředá se
  NOTIFICATION_EMAIL: ${NOTIFICATION_EMAIL}
```
Pak pokud je proměnná v `.env` nedefinovaná, docker-compose vyhlásí warning ale spustí se (proměnná prostě nebude v kontejneru → `process.env.X` undefined → zod `.optional()` pass).

Alternativně — a to je správnější řešení — fix v `env.ts` (viz další bug).

### 🐛 env.ts je zbytečně přísný — prázdný string fail na optional polí

**Stav:** Zod schéma v `src/lib/env.ts` má:
```ts
RESEND_API_KEY: z.string().min(10).optional(),
NOTIFICATION_FROM: z.string().email().optional(),
NOTIFICATION_EMAIL: z.string().email().optional(),
```
`.optional()` akceptuje jen `undefined`, ne prázdný string. Když je v `.env` řádek `RESEND_API_KEY=` (prázdný), zod failuje.

**Dopad:** Při prvním deployi jsme museli ty prázdné řádky z `.env` na NASu vymazat. Celá aplikace padala na 500 při jakémkoli DB volání (env se vyhodnocuje lazy při prvním prisma callu — typicky v login endpoint `checkLoginRateLimit`).

**Workaround (aktuální stav):** Na NASu v `/volume1/docker/raseliniste/.env` **nesmí být** řádky `RESEND_API_KEY=` a `NOTIFICATION_EMAIL=` pokud jsou prázdné. Buď tam mají být **plné hodnoty**, nebo **nebýt vůbec**.

**Fix (k udělání):**
```ts
// src/lib/env.ts
RESEND_API_KEY: z.string().min(10).optional().or(z.literal("")),
NOTIFICATION_FROM: z.string().email().optional().or(z.literal("")),
NOTIFICATION_EMAIL: z.string().email().optional().or(z.literal("")),
```

`.or(z.literal(""))` přidá prázdný string jako validní variantu. Pak lib/mailer.ts už má check `if (!apiKey || !from)` který prázdný string obslouží jako „nenastaveno".

Čas opravy: ~5 min (edit + commit + push + rebuild).

### 🐛 heal-migrations.mjs má Prisma 6 import style

**Stav:** `scripts/heal-migrations.mjs` začíná:
```js
import { PrismaClient } from "@prisma/client";
```
V Prisma 7 je `@prisma/client` CommonJS re-export a named ES import failuje s `SyntaxError: Named export 'PrismaClient' not found`.

**Dopad:** Při startu kontejneru entrypoint skipne heal step (`[entrypoint] heal-migrations skipped`). Migrace samotná proběhne OK (dělá ji `prisma migrate deploy`, ne heal). Problém by nastal jen pokud by se dřív zasekla migrace (failed row v `_prisma_migrations`) — pak by deploy failoval bez cleanup.

**Fix:**
```js
// scripts/heal-migrations.mjs
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
// ...zbytek stejný
```

Nebo (jednodušší) použít raw SQL přes `pg` bez Prisma — skript má pořád jen 1 DELETE query, nepotřebuje ORM.

Čas opravy: ~5 min.

### 🐛 Seed script nefunguje v produkčním kontejneru

**Stav:** `prisma/seed.ts` importuje z `src/lib/db` a `src/lib/env`, které NENÍ v produkčním Docker image (kopírujeme jen `dist/`). Workaround použit při prvním seedu přes přímý SQL INSERT.

**Dopad:** Pokud budeš potřebovat druhého usera v budoucnu, nepůjde to přes `npm run db:seed` v produkci. Nevadí v praxi — Rašeliniště je single-user.

**Fix:** přepsat `seed.ts` aby používal přímo `@/generated/prisma/client` + inline argon2 (bez dependency na naše wrappers). Pak `copy scripts/seed.ts` do runner image. Je to 15 minut práce, udělám při příští dev seanci.

### 🔶 Enrollment druhého passkey z jiného zařízení

**Stav:** Aktuální UI enrollment spouští jen při `enroll_passkey` stavu (když uživatel nemá žádný passkey). Přidat druhé zařízení vyžaduje UI v Settings.

**Dopad:** iPhone nebo jiný počítač se může přihlásit heslem, ale ne passkey (dokud nepřidám UI).

**Fix:** přidat stránku `/settings/security` s `Přidat další passkey` tlačítkem. Backend endpoint už máme (`register-options/verify`), jen potřebuje novou podmínku, že už je přihlášený user.

### 🔶 Žádný health check endpoint

**Stav:** Nemáme `/api/health` co by vracelo `{ok: true, db: connected}` pro monitoring.

**Dopad:** Synology monitoring nemá co chytit. Uptime monitorovací služba (např. UptimeRobot) si nemá na co pingnout.

**Fix:** přidat triviální endpoint. Drobnost.

---

## Kontakt / Eskalace

- Produkt je **single-user personal**, takže žádný další admin neexistuje. Jsi ty + já (Claude / Claude Code).
- Když něco rozjedeš a nevíš, co dál:
  1. **Backup** (sekce 7) — vždy před riskantní akcí
  2. **Log** (sekce 8) — čti ho, je tam 90 % odpovědí
  3. **Napiš mi** — pošli snapshot logu, popis co jsi udělal, co se stalo, a co čekáš

---

*Poslední update: 2026-04-20, bezprostředně po prvním úspěšném produkčním loginu.*
